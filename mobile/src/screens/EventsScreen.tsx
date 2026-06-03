import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { listEvents } from '../api';
import type { Event } from '../types';
import { EVENT_STATUS_LABELS } from '../types';
import { theme } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Events'>;
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function statusColor(status: Event['status']): string {
  switch (status) {
    case 'live':
      return theme.colors.success;
    case 'revealed':
      return theme.colors.accent;
    case 'archived':
    case 'deleted':
      return theme.colors.textMuted;
    default:
      return theme.colors.textSecondary;
  }
}

function EventCard({
  item,
  onPress,
}: {
  item: Event;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={[styles.statusBadge, { borderColor: statusColor(item.status) }]}>
          <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
            {EVENT_STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>

      <View style={styles.cardMeta}>
        <Text style={styles.metaText}>
          Создано: {formatDate(item.created_at)}
        </Text>
        <Text style={styles.metaText}>
          Тариф:{' '}
          <Text style={styles.metaAccent}>{item.plan.toUpperCase()}</Text>
        </Text>
      </View>

      {item.reveal_at && (
        <Text style={styles.revealText}>
          Проявка: {formatDate(item.reveal_at)}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export default function EventsScreen({ navigation }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const data = await listEvents();
      setEvents(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
      setError(message);
      if (isRefresh) {
        Alert.alert('Ошибка загрузки', message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Перезагружаем список при возврате на экран
  useFocusEffect(
    useCallback(() => {
      fetchEvents();
    }, [fetchEvents]),
  );

  function onRefresh() {
    setRefreshing(true);
    fetchEvents(true);
  }

  function openEvent(item: Event) {
    navigation.navigate('Gallery', { eventId: item.id, revealAt: item.reveal_at });
  }

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (error && events.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchEvents()}>
            <Text style={styles.retryBtnText}>Повторить</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Мои события</Text>
        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => navigation.navigate('CreateEvent')}
          activeOpacity={0.8}
        >
          <Text style={styles.createBtnText}>+ Создать</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          events.length === 0 ? styles.listEmpty : styles.list
        }
        renderItem={({ item }) => (
          <EventCard item={item} onPress={() => openEvent(item)} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📷</Text>
            <Text style={styles.emptyTitle}>Событий пока нет</Text>
            <Text style={styles.emptySubtitle}>
              Создайте первое событие и поделитесь QR-кодом с гостями
            </Text>
            <TouchableOpacity
              style={styles.createFirstBtn}
              onPress={() => navigation.navigate('CreateEvent')}
              activeOpacity={0.8}
            >
              <Text style={styles.createFirstBtnText}>Создать событие</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: theme.font.sizes.xl,
    fontWeight: '700',
    color: theme.colors.text,
  },
  createBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  createBtnText: {
    fontSize: theme.font.sizes.sm,
    fontWeight: '700',
    color: theme.colors.background,
  },
  list: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  listEmpty: {
    flex: 1,
    padding: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  cardTitle: {
    flex: 1,
    fontSize: theme.font.sizes.md,
    fontWeight: '600',
    color: theme.colors.text,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: theme.font.sizes.xs,
    fontWeight: '600',
  },
  cardMeta: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginBottom: 4,
  },
  metaText: {
    fontSize: theme.font.sizes.xs,
    color: theme.colors.textSecondary,
  },
  metaAccent: {
    color: theme.colors.accent,
  },
  revealText: {
    fontSize: theme.font.sizes.xs,
    color: theme.colors.textMuted,
    marginTop: 4,
  },
  errorText: {
    fontSize: theme.font.sizes.sm,
    color: theme.colors.error,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  retryBtn: {
    borderWidth: 1,
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  retryBtnText: {
    color: theme.colors.accent,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: theme.spacing.md,
  },
  emptyTitle: {
    fontSize: theme.font.sizes.lg,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  emptySubtitle: {
    fontSize: theme.font.sizes.sm,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: theme.spacing.xl,
  },
  createFirstBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
  },
  createFirstBtnText: {
    fontSize: theme.font.sizes.md,
    fontWeight: '700',
    color: theme.colors.background,
  },
});
