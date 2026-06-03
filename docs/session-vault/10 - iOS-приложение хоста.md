---
type: note
tags: [кадр, ios, swiftui, фаза5]
---

# 10 — iOS-приложение хоста

[[00 - Карта проекта|← к карте]]

SwiftUI, iOS 17+, Observation framework (`@Observable`/`@MainActor`). Папка `ios/`. **Собрано: BUILD SUCCEEDED** через xcodebuild под симулятор iPhone 17 Pro (0 ошибок).

## Как открыть и запустить (из README)

```bash
brew install xcodegen
cd ios
xcodegen generate      # создаёт Kadr.xcodeproj из project.yml
open Kadr.xcodeproj
```
В Xcode: заполнить `Kadr/AppConfig.swift` (`anonKey` из `supabase status`, `hostJWT` по инструкции в README), выбрать симулятор iPhone (iOS 17+), Cmd+R.

> [!note] .xcodeproj не в git
> Генерируется из `project.yml` через xcodegen (в .gitignore). Коммитим только исходники + project.yml.

## Экраны (§8.1)

| Экран | Файл | Статус |
|---|---|---|
| Логин (телефон/OTP/mock) + согласие | `Views/Auth/LoginView.swift` | готово |
| Мои события | `Views/Events/EventsListView.swift` | готово |
| Создание события | `Views/Events/CreateEventView.swift` | готово |
| QR / Поделиться | `Views/QR/QRShareView.swift` | готово (QR локально через CoreImage) |
| Галерея (Все/По гостям, избранное, проявка) | `Views/Gallery/GalleryView.swift` | готово |
| Тариф, Приватность | `Views/Stubs/` | заглушки |

## Архитектура

- `AppConfig.swift` — baseURL, anonKey, **hostJWT** (для локального теста), policyVersion.
- `Network/APIClient.swift` — URLSession async/await: createEvent, listEvents, revealEvent, listPhotos, photoURL, setFavorite. Заголовки Authorization+apikey, декод ошибок `{ error: { code, message } }`.
- `Models/` — Event, Photo, CameraStyle, ApiError (Codable, ISO8601-даты).
- `ViewModels/` — `@Observable`, состояния loading/error/data.

## Зависимость: бэкенд хоста (сделан в этой же фазе)

- Edge Function `create-event` — создание события, уникальный short_code, expires_at из `plans`, рендер QR PNG в бакет, подписанный qr_url. См. [[03 - Бэкенд (Supabase)]].
- Edge Function `reveal` — ручная проявка (status=revealed), коды 403/404/409.

## Как получить hostJWT на локалке (важно)

Кастомных OTP-эндпойнтов на локалке ещё нет. Рабочий способ:
1. `admin.createUser` через Admin API (service-role) — создать хоста.
2. Вручную сминтить authenticated-JWT (HS256, локальный `JWT_SECRET` из `supabase status -o env`), payload `aud=authenticated, role=authenticated, sub=<uid>, iss=.../auth/v1`. **Без `session_id`** (иначе GoTrue → 403 session_not_found).
3. Вставить в `AppConfig.hostJWT`.

## Инварианты 152-ФЗ

- Нет `import Vision`/VisionKit (запрет распознавания лиц).
- Ноль зарубежных SDK (только Foundation/SwiftUI/CoreImage/UIKit/SafariServices).
- Аналитика не подключена (место под AppMetrica — TODO).
- Фото только через подписанные URL (`photo-url`).
- Согласие хоста не предзаполнено (`consentChecked=false`).

## Грабли

- `GalleryView`: `Picker`/`.alert` требуют `Binding` → `$vm.selectedTab`, `$vm.showRevealConfirm` (через `@Bindable var vm`). Изначально было без `$` → BUILD FAILED, поймано реальной сборкой xcodebuild. См. [[06 - Грабли и решения]].

## Отложено (TODO)

- Камера хоста (AVFoundation + Core Image фильтры). `NSCameraUsageDescription` уже в Info.plist.
- OTP через российский SMS (SMS Aero/SMSC) — `AuthService` переключится при пустом hostJWT.
- Биллинг (WebView ЮKassa), APNs пуши.
