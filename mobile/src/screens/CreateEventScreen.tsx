import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { createEvent } from '../api';
import type { CameraStyle } from '../types';
import { CAMERA_STYLE_LABELS } from '../types';
import { theme } from '../theme';
import { POLICY_VERSION } from '../config';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CreateEvent'>;
};

const CAMERA_STYLES: CameraStyle[] = ['film35', 'vintage', 'bw', 'summer'];

export default function CreateEventScreen({ navigation }: Props) {
  const [title, setTitle] = useState('');
  const [cameraStyle, setCameraStyle] = useState<CameraStyle>('film35');
  const [shotsPerGuest, setShotsPerGuest] = useState('50');
  const [delayedReveal, setDelayedReveal] = useState(false); // без проявки = мгновенно
  const [revealHours, setRevealHours] = useState('2'); // часов от начала
  const [agreed, setAgreed] = useState(false); // 152-ФЗ: не предзаполнен
  const [loading, setLoading] = useState(false);

  function validateForm(): string | null {
    if (!title.trim()) return 'Введите название события';
    if (title.trim().length > 120) return 'Название не длиннее 120 символов';
    const shots = parseInt(shotsPerGuest, 10);
    if (isNaN(shots) || shots < 1 || shots > 1000) {
      return 'Кадров на гостя: от 1 до 1000';
    }
    if (!agreed) return 'Необходимо согласие на обработку данных';
    return null;
  }

  async function handleCreate() {
    const err = validateForm();
    if (err) {
      Alert.alert('Ошибка', err);
      return;
    }

    setLoading(true);
    try {
      const now = new Date();
      let revealAt: string | null = null;
      if (delayedReveal) {
        const hours = parseFloat(revealHours) || 2;
        const revealDate = new Date(now.getTime() + hours * 60 * 60 * 1000);
        revealAt = revealDate.toISOString();
      }

      const result = await createEvent({
        title: title.trim(),
        camera_style: cameraStyle,
        shots_per_guest: parseInt(shotsPerGuest, 10),
        reveal_at: revealAt,
        starts_at: now.toISOString(),
      });

      navigation.replace('QR', {
        joinUrl: result.join_url,
        eventId: result.id,
        eventTitle: title.trim(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
      Alert.alert('Не удалось создать событие', message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {/* Заголовок */}
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={styles.backBtnText}>← Назад</Text>
            </TouchableOpacity>
            <Text style={styles.pageTitle}>Новое событие</Text>
          </View>

          {/* Название */}
          <View style={styles.field}>
            <Text style={styles.label}>Название события</Text>
            <TextInput
              style={styles.input}
              placeholder="Свадьба Ани и Пети"
              placeholderTextColor={theme.colors.textMuted}
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              returnKeyType="done"
            />
          </View>

          {/* Стиль камеры */}
          <View style={styles.field}>
            <Text style={styles.label}>Стиль камеры</Text>
            <View style={styles.styleGrid}>
              {CAMERA_STYLES.map((style) => (
                <TouchableOpacity
                  key={style}
                  style={[
                    styles.styleChip,
                    cameraStyle === style && styles.styleChipActive,
                  ]}
                  onPress={() => setCameraStyle(style)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.styleChipText,
                      cameraStyle === style && styles.styleChipTextActive,
                    ]}
                  >
                    {CAMERA_STYLE_LABELS[style]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Кадров на гостя */}
          <View style={styles.field}>
            <Text style={styles.label}>Кадров на гостя</Text>
            <View style={styles.shotsRow}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => {
                  const v = Math.max(1, parseInt(shotsPerGuest, 10) - 5);
                  setShotsPerGuest(String(v));
                }}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.shotsInput}
                value={shotsPerGuest}
                onChangeText={(v) => setShotsPerGuest(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={4}
              />
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => {
                  const v = Math.min(1000, parseInt(shotsPerGuest, 10) + 5);
                  setShotsPerGuest(String(v));
                }}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Отложенная проявка */}
          <View style={styles.field}>
            <View style={styles.switchRow}>
              <View style={styles.switchLabelBlock}>
                <Text style={styles.label}>Отложенная проявка</Text>
                <Text style={styles.switchHint}>
                  Гости не видят общую галерею до проявки
                </Text>
              </View>
              <Switch
                value={delayedReveal}
                onValueChange={setDelayedReveal}
                trackColor={{
                  false: theme.colors.border,
                  true: theme.colors.accentDim,
                }}
                thumbColor={delayedReveal ? theme.colors.accent : theme.colors.textSecondary}
              />
            </View>

            {delayedReveal && (
              <View style={styles.revealHoursBlock}>
                <Text style={styles.sublabel}>Проявить через (часов):</Text>
                <TextInput
                  style={styles.smallInput}
                  value={revealHours}
                  onChangeText={(v) => setRevealHours(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  maxLength={4}
                  placeholder="2"
                  placeholderTextColor={theme.colors.textMuted}
                />
              </View>
            )}
          </View>

          {/* Согласие */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAgreed((v) => !v)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>
              Даю согласие на обработку персональных данных участников события
              (152-ФЗ, версия политики {POLICY_VERSION})
            </Text>
          </TouchableOpacity>

          {/* Кнопка создать */}
          <TouchableOpacity
            style={[styles.createBtn, (!agreed || loading) && styles.createBtnDisabled]}
            onPress={handleCreate}
            disabled={!agreed || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={theme.colors.background} />
            ) : (
              <Text style={styles.createBtnText}>Создать событие</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  pageHeader: {
    marginBottom: theme.spacing.xl,
  },
  backBtn: {
    marginBottom: theme.spacing.sm,
  },
  backBtnText: {
    color: theme.colors.accent,
    fontSize: theme.font.sizes.sm,
  },
  pageTitle: {
    fontSize: theme.font.sizes.xl,
    fontWeight: '700',
    color: theme.colors.text,
  },
  field: {
    marginBottom: theme.spacing.lg,
  },
  label: {
    fontSize: theme.font.sizes.sm,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sublabel: {
    fontSize: theme.font.sizes.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontSize: theme.font.sizes.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    minHeight: 52,
  },
  styleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  styleChip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
  },
  styleChipActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentDim + '33',
  },
  styleChipText: {
    fontSize: theme.font.sizes.sm,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  styleChipTextActive: {
    color: theme.colors.accent,
    fontWeight: '700',
  },
  shotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  stepBtn: {
    width: 44,
    height: 44,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 22,
    color: theme.colors.accent,
    fontWeight: '600',
    lineHeight: 28,
  },
  shotsInput: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontSize: theme.font.sizes.lg,
    textAlign: 'center',
    paddingVertical: theme.spacing.sm,
    fontWeight: '700',
    height: 52,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  switchLabelBlock: {
    flex: 1,
  },
  switchHint: {
    fontSize: theme.font.sizes.xs,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  revealHoursBlock: {
    marginTop: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  smallInput: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontSize: theme.font.sizes.md,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    width: 80,
    fontWeight: '700',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
    borderColor: theme.colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  checkmark: {
    color: theme.colors.background,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: theme.font.sizes.sm,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
  createBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  createBtnDisabled: {
    opacity: 0.4,
  },
  createBtnText: {
    fontSize: theme.font.sizes.md,
    fontWeight: '700',
    color: theme.colors.background,
    letterSpacing: 0.5,
  },
});
