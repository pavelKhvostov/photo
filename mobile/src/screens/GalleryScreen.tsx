import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { listPhotos, photoURL, setFavorite, revealEvent } from '../api';
import type { Photo } from '../types';
import { theme } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Gallery'>;
  route: RouteProp<RootStackParamList, 'Gallery'>;
};

const COLUMN_COUNT = 3;
const SCREEN_WIDTH = Dimensions.get('window').width;
const CELL_SIZE =
  (SCREEN_WIDTH - theme.spacing.md * 2 - theme.spacing.xs * (COLUMN_COUNT - 1)) /
  COLUMN_COUNT;

type TabKey = 'all' | 'by_guest';

function formatRevealTime(revealAt: string | null): string | null {
  if (!revealAt) return null;
  const date = new Date(revealAt);
  if (date <= new Date()) return null; // уже наступила проявка
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// --------------------------------------------------------------------------
// Ячейка фото
// --------------------------------------------------------------------------

function PhotoCell({
  photo,
  onFavoriteToggle,
}: {
  photo: Photo;
  onFavoriteToggle: (id: string, current: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(true);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Инвариант 152-ФЗ: фото только через подписанный URL
    photoURL(photo.id)
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch(() => {
        if (!cancelled) setImgError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingUrl(false);
      });
    return () => {
      cancelled = true;
    };
  }, [photo.id]);

  return (
    <View style={styles.cell}>
      {loadingUrl ? (
        <View style={styles.cellPlaceholder}>
          <ActivityIndicator color={theme.colors.accent} size="small" />
        </View>
      ) : imgError || !url ? (
        <View style={styles.cellPlaceholder}>
          <Text style={styles.cellErrorText}>!</Text>
        </View>
      ) : (
        <Image
          source={{ uri: url }}
          style={styles.cellImage}
          resizeMode="cover"
          onError={() => setImgError(true)}
        />
      )}

      {/* Кнопка избранного (только хост) */}
      <TouchableOpacity
        style={styles.favoriteBtn}
        onPress={() => onFavoriteToggle(photo.id, photo.is_favorite)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.favoriteStar}>
          {photo.is_favorite ? '★' : '☆'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// --------------------------------------------------------------------------
// Основной экран
// --------------------------------------------------------------------------

export default function GalleryScreen({ navigation, route }: Props) {
  const { eventId, revealAt } = route.params;

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('all');
  const [revealing, setRevealing] = useState(false);

  // Уникальные guest_id для фильтра «По гостям»
  const guestIdsRef = useRef<string[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<string | null>(null);

  const revealTime = formatRevealTime(revealAt);
  const isNotRevealed = revealTime !== null;

  const fetchPhotos = useCallback(
    async (isRefresh = false) => {
      if (!isRefresh) setLoading(true);
      setError(null);
      try {
        const data = await listPhotos(eventId);
        setPhotos(data);
        const ids = Array.from(new Set(data.map((p) => p.guest_id)));
        guestIdsRef.current = ids;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка загрузки';
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [eventId],
  );

  useFocusEffect(
    useCallback(() => {
      fetchPhotos();
    }, [fetchPhotos]),
  );

  function onRefresh() {
    setRefreshing(true);
    fetchPhotos(true);
  }

  async function handleFavoriteToggle(photoId: string, currentValue: boolean) {
    const newValue = !currentValue;
    // Оптимистичное обновление
    setPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, is_favorite: newValue } : p)),
    );
    try {
      await setFavorite(photoId, newValue);
    } catch {
      // Откат при ошибке
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId ? { ...p, is_favorite: currentValue } : p,
        ),
      );
      Alert.alert('Ошибка', 'Не удалось обновить избранное');
    }
  }

  async function handleReveal() {
    Alert.alert(
      'Проявить сейчас?',
      'Все гости увидят общую галерею. Отменить это действие нельзя.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Проявить',
          style: 'destructive',
          onPress: async () => {
            setRevealing(true);
            try {
              await revealEvent(eventId);
              fetchPhotos();
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Ошибка';
              Alert.alert('Ошибка проявки', message);
            } finally {
              setRevealing(false);
            }
          },
        },
      ],
    );
  }

  // Фильтрация по гостю
  const displayedPhotos =
    tab === 'by_guest' && selectedGuest
      ? photos.filter((p) => p.guest_id === selectedGuest)
      : photos;

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Шапка */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Галерея</Text>
        {isNotRevealed && (
          <TouchableOpacity
            style={styles.revealBtn}
            onPress={handleReveal}
            disabled={revealing}
            activeOpacity={0.8}
          >
            {revealing ? (
              <ActivityIndicator color={theme.colors.background} size="small" />
            ) : (
              <Text style={styles.revealBtnText}>Проявить</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Плашка до проявки (§9 edge case 4) */}
      {isNotRevealed && (
        <View style={styles.revealBanner}>
          <Text style={styles.revealBannerText}>
            Фото проявятся в {revealTime}. Ваши кадры видны ниже.
          </Text>
        </View>
      )}

      {/* Табы */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'all' && styles.tabActive]}
          onPress={() => {
            setTab('all');
            setSelectedGuest(null);
          }}
        >
          <Text style={[styles.tabText, tab === 'all' && styles.tabTextActive]}>
            Все
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'by_guest' && styles.tabActive]}
          onPress={() => setTab('by_guest')}
        >
          <Text
            style={[styles.tabText, tab === 'by_guest' && styles.tabTextActive]}
          >
            По гостям
          </Text>
        </TouchableOpacity>
      </View>

      {/* Горизонтальный фильтр гостей */}
      {tab === 'by_guest' && guestIdsRef.current.length > 0 && (
        <FlatList
          horizontal
          data={guestIdsRef.current}
          keyExtractor={(id) => id}
          contentContainerStyle={styles.guestFilterList}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item: gId }) => (
            <TouchableOpacity
              style={[
                styles.guestChip,
                selectedGuest === gId && styles.guestChipActive,
              ]}
              onPress={() =>
                setSelectedGuest((prev) => (prev === gId ? null : gId))
              }
            >
              <Text
                style={[
                  styles.guestChipText,
                  selectedGuest === gId && styles.guestChipTextActive,
                ]}
              >
                {gId.slice(0, 8)}...
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Ошибка */}
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Сетка фото */}
      <FlatList
        data={displayedPhotos}
        keyExtractor={(item) => item.id}
        numColumns={COLUMN_COUNT}
        contentContainerStyle={
          displayedPhotos.length === 0 ? styles.gridEmpty : styles.grid
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
        renderItem={({ item }) => (
          <PhotoCell photo={item} onFavoriteToggle={handleFavoriteToggle} />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🎞</Text>
            <Text style={styles.emptyTitle}>
              {tab === 'by_guest' && selectedGuest
                ? 'У этого гостя нет фото'
                : 'Фото пока нет'}
            </Text>
            <Text style={styles.emptySubtitle}>
              Поделитесь QR-кодом с гостями, чтобы они начали снимать
            </Text>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  backBtn: {
    paddingRight: theme.spacing.xs,
  },
  backBtnText: {
    color: theme.colors.accent,
    fontSize: theme.font.sizes.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: theme.font.sizes.lg,
    fontWeight: '700',
    color: theme.colors.text,
  },
  revealBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    minWidth: 80,
    alignItems: 'center',
    minHeight: 34,
    justifyContent: 'center',
  },
  revealBtnText: {
    fontSize: theme.font.sizes.sm,
    fontWeight: '700',
    color: theme.colors.background,
  },
  revealBanner: {
    backgroundColor: '#a07c3622',
    borderBottomWidth: 1,
    borderBottomColor: '#a07c3655',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  revealBannerText: {
    fontSize: theme.font.sizes.sm,
    color: theme.colors.accent,
    textAlign: 'center',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: theme.colors.accent,
  },
  tabText: {
    fontSize: theme.font.sizes.sm,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  tabTextActive: {
    color: theme.colors.accent,
    fontWeight: '700',
  },
  guestFilterList: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  guestChip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.surface,
    marginRight: theme.spacing.sm,
  },
  guestChipActive: {
    borderColor: theme.colors.accent,
    backgroundColor: '#a07c3633',
  },
  guestChipText: {
    fontSize: theme.font.sizes.xs,
    color: theme.colors.textSecondary,
  },
  guestChipTextActive: {
    color: theme.colors.accent,
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#e0575722',
    padding: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.font.sizes.sm,
    textAlign: 'center',
  },
  grid: {
    padding: theme.spacing.md,
  },
  gridEmpty: {
    flex: 1,
    padding: theme.spacing.md,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    marginBottom: theme.spacing.xs,
    marginRight: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
    position: 'relative',
  },
  cellPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceElevated,
  },
  cellErrorText: {
    color: theme.colors.textMuted,
    fontSize: theme.font.sizes.md,
  },
  cellImage: {
    width: '100%',
    height: '100%',
  },
  favoriteBtn: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#11101099',
    borderRadius: theme.radius.full,
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favoriteStar: {
    fontSize: 14,
    color: theme.colors.accent,
    lineHeight: 18,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xxl,
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
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: theme.font.sizes.sm,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
