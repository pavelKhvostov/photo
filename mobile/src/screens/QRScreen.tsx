import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { theme } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'QR'>;
  route: RouteProp<RootStackParamList, 'QR'>;
};

export default function QRScreen({ navigation, route }: Props) {
  const { joinUrl, eventId, eventTitle } = route.params;

  async function handleShare() {
    try {
      await Share.share({
        message: `${eventTitle}\n\nПрисоединяйтесь по ссылке: ${joinUrl}`,
        url: joinUrl, // iOS использует url при наличии
        title: eventTitle,
      });
    } catch {
      // пользователь закрыл sheet — нормально
    }
  }

  function goToEvents() {
    navigation.navigate('Events');
  }

  function goToGallery() {
    navigation.navigate('Gallery', { eventId, revealAt: null });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Событие создано!</Text>
        <Text style={styles.eventTitle}>{eventTitle}</Text>

        <Text style={styles.instruction}>
          Покажите QR-код гостям или отправьте ссылку. Гости войдут без
          установки приложения.
        </Text>

        {/* Большой QR */}
        <View style={styles.qrContainer}>
          {/* joinUrl кодируется как есть — бэкенд уже сформировал правильный URL */}
          <QRCode
            value={joinUrl}
            size={240}
            color={theme.colors.background}
            backgroundColor={theme.colors.text}
            quietZone={16}
          />
        </View>

        {/* Короткая ссылка текстом */}
        <View style={styles.urlContainer}>
          <Text style={styles.urlLabel}>Ссылка для гостей:</Text>
          <Text style={styles.urlText} selectable>
            {joinUrl}
          </Text>
        </View>

        {/* Кнопки */}
        <TouchableOpacity
          style={styles.shareBtn}
          onPress={handleShare}
          activeOpacity={0.8}
        >
          <Text style={styles.shareBtnText}>Поделиться</Text>
        </TouchableOpacity>

        <View style={styles.secondaryBtns}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={goToGallery}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryBtnText}>Открыть галерею</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, styles.secondaryBtnOutline]}
            onPress={goToEvents}
            activeOpacity={0.8}
          >
            <Text style={[styles.secondaryBtnText, styles.secondaryBtnTextOutline]}>
              К событиям
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    alignItems: 'center',
    paddingBottom: theme.spacing.xxl,
  },
  title: {
    fontSize: theme.font.sizes.xl,
    fontWeight: '700',
    color: theme.colors.success,
    marginBottom: theme.spacing.xs,
    textAlign: 'center',
  },
  eventTitle: {
    fontSize: theme.font.sizes.md,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
    fontWeight: '500',
  },
  instruction: {
    fontSize: theme.font.sizes.sm,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: theme.spacing.xl,
    paddingHorizontal: theme.spacing.md,
  },
  qrContainer: {
    backgroundColor: theme.colors.text,
    padding: 16,
    borderRadius: theme.radius.lg,
    marginBottom: theme.spacing.xl,
    // Тень для визуального выделения
    shadowColor: theme.colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  urlContainer: {
    width: '100%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  urlLabel: {
    fontSize: theme.font.sizes.xs,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  urlText: {
    fontSize: theme.font.sizes.sm,
    color: theme.colors.accent,
    fontWeight: '500',
  },
  shareBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    alignItems: 'center',
    width: '100%',
    minHeight: 52,
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  shareBtnText: {
    fontSize: theme.font.sizes.md,
    fontWeight: '700',
    color: theme.colors.background,
  },
  secondaryBtns: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    width: '100%',
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryBtnOutline: {
    backgroundColor: 'transparent',
    borderColor: theme.colors.accent,
  },
  secondaryBtnText: {
    fontSize: theme.font.sizes.sm,
    fontWeight: '600',
    color: theme.colors.text,
  },
  secondaryBtnTextOutline: {
    color: theme.colors.accent,
  },
});
