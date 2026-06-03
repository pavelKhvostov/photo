# iOS-приложение «Кадр» (хост)

SwiftUI, iOS 17+. Организатор события — аналог pov.camera для РФ.

---

## Способ 1 (рекомендуемый): XcodeGen

XcodeGen генерирует `.xcodeproj` из `project.yml` — 3 команды и готово.

```bash
# Установить XcodeGen (если нет)
brew install xcodegen

# Перейти в папку ios/
cd /Users/pavelhvostov/Desktop/photo/ios

# Сгенерировать проект
xcodegen generate

# Открыть в Xcode
open Kadr.xcodeproj
```

После открытия:
1. Выберите симулятор **iPhone 15** (iOS 17.0+).
2. Откройте `Kadr/AppConfig.swift` и заполните поля (см. ниже).
3. Нажмите **Run** (Cmd+R).

---

## Способ 2: вручную в Xcode (без XcodeGen)

1. Откройте Xcode 15+.
2. **File → New → Project…** → iOS → App.
3. Параметры:
   - Product Name: `Kadr`
   - Bundle Identifier: `ru.kadr.app`
   - Interface: **SwiftUI**, Language: **Swift**
   - Deployment Target: **iOS 17.0**
4. Сохраните в `/Users/pavelhvostov/Desktop/photo/ios/Kadr/`.
5. Удалите стандартные `ContentView.swift` и `KadrApp.swift`.
6. **File → Add Files to "Kadr"…** — выберите все `.swift` файлы из `ios/Kadr/`
   (рекурсивно, со всеми подпапками). Убедитесь, что галочка «Copy items if needed»
   **снята** (файлы уже на месте).
7. В настройках таргета на вкладке **Info** укажите `Info.plist` из `ios/Kadr/`.
8. Добавьте `Assets.xcassets` из `ios/Kadr/` через Add Files.

---

## Настройка перед запуском

Откройте `Kadr/AppConfig.swift`:

```swift
static let baseURL = "http://127.0.0.1:54321"   // для симулятора
// или "http://192.168.X.X:54321"                // для реального устройства

static let anonKey = "ВСТАВЬ_ANON_KEY_ЗДЕСЬ"    // из `supabase status`
static let hostJWT = ""                           // тестовый JWT (см. ниже)
```

### Как получить тестовый hostJWT

```bash
# 1. Запустить Supabase
supabase start

# 2. Посмотреть ключи
supabase status
# Скопировать: API URL, anon key, service_role key

# 3. Создать тестового хоста
curl -X POST 'http://127.0.0.1:54321/auth/v1/admin/users' \
  -H 'apikey: <service_role_key>' \
  -H 'Authorization: Bearer <service_role_key>' \
  -H 'Content-Type: application/json' \
  -d '{"phone": "+79001234567", "phone_confirm": true, "password": "test1234"}'

# 4. Получить JWT
curl -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H 'apikey: <anon_key>' \
  -H 'Content-Type: application/json' \
  -d '{"phone": "+79001234567", "password": "test1234"}'

# access_token из ответа — вставить в AppConfig.hostJWT
```

Когда `hostJWT` заполнен, на экране логина появится кнопка **«Войти с тестовым токеном»**.

---

## Структура проекта

```
ios/
├── project.yml                    -- XcodeGen конфиг
├── README.md                      -- этот файл
└── Kadr/
    ├── KadrApp.swift              -- точка входа @main
    ├── AppConfig.swift            -- baseURL, anonKey, hostJWT, policyVersion
    ├── Info.plist                 -- разрешения, ATS для локальной сети
    ├── Assets.xcassets/
    ├── Models/
    │   ├── Event.swift            -- Event, CameraStyle, EventStatus, PlanCode
    │   ├── Photo.swift            -- Photo, PhotoURLResponse
    │   └── ApiError.swift         -- KadrError, ApiErrorResponse
    ├── Network/
    │   └── APIClient.swift        -- URLSession async/await, все API-методы
    ├── Services/
    │   └── AuthService.swift      -- @MainActor, mock/otp режим
    ├── ViewModels/
    │   ├── AuthViewModel.swift    -- заглушка (не используется)
    │   ├── CreateEventViewModel.swift -- заглушка
    │   ├── EventsViewModel.swift  -- загрузка списка событий
    │   ├── GalleryViewModel.swift -- галерея, проявка, избранное
    │   └── QRViewModel.swift      -- генерация QR через Core Image
    ├── Views/
    │   ├── RootView.swift         -- маршрутизация auth → main
    │   ├── MainTabView.swift      -- TabView (События / Приватность)
    │   ├── Auth/
    │   │   └── LoginView.swift    -- телефон+OTP + кнопка mock
    │   ├── Events/
    │   │   ├── EventsListView.swift
    │   │   ├── EventCardView.swift
    │   │   └── CreateEventView.swift
    │   ├── QR/
    │   │   └── QRShareView.swift
    │   ├── Gallery/
    │   │   ├── GalleryView.swift
    │   │   ├── PhotoGridView.swift
    │   │   └── PhotoCell.swift
    │   └── Stubs/
    │       ├── TariffView.swift
    │       └── PrivacyView.swift
    └── Shared/
        └── Theme.swift            -- цвета, кнопки, поля ввода
```

---

## Что реализовано

| Экран | Статус |
|---|---|
| Логин (телефон + OTP / mock) | Готово |
| Согласие хоста (152-ФЗ, не предзаполнено) | Готово |
| Мои события (список, pull-to-refresh, пустое состояние) | Готово |
| Создание события (форма, валидация, согласие) | Готово |
| QR / Поделиться (Core Image, ShareSheet) | Готово |
| Галерея (сетка, табы, избранное, плашка до проявки) | Готово |
| Ручная проявка (диалог подтверждения) | Готово |
| Фото через подписанные URL | Готово |
| Тариф | Заглушка (TODO: WebView ЮKassa) |
| Приватность (ссылка на политику, удаление данных) | Заглушка |
| Камера хоста (видоискатель + Core Image фильтры) | TODO |

---

## Инварианты 152-ФЗ (подтверждение)

- **Нет Vision framework** — ни одного импорта `Vision`, `VisionKit`, face API.
- **Нет зарубежных SDK** — Firebase, Google Analytics, Amplitude, Mixpanel не подключены.
- **Аналитика** — не подключена (место отмечено TODO для AppMetrica SDK).
- **Фото** — отображаются исключительно через `GET /functions/v1/photo-url` (подписанный URL с TTL). Публичных ссылок нет.
- **Согласие хоста** — чекбокс на экранах логина и создания события, не предзаполнен.
- **baseURL** — указывает на self-hosted Supabase (РФ-инфраструктура по умолчанию).

---

## Отложено

- **Камера хоста** — `CameraView.swift` с `AVFoundation` + Core Image фильтры (film35/vintage/bw/summer) в реальном времени. `NSCameraUsageDescription` уже прописан в `Info.plist`.
- **OTP через SMS** — `AuthService.mode = .otp` включится автоматически когда `AppConfig.hostJWT` пуст.
- **Биллинг** — `TariffView` покажет WebView ЮKassa после реализации `/billing/checkout`.
- **APNs** — push-уведомления о проявке.
