import Foundation
import Observation

// MARK: - GalleryTab

enum GalleryTab: String, CaseIterable, Identifiable {
    case all     = "all"
    case byGuest = "byGuest"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .all:     return "Все"
        case .byGuest: return "По гостям"
        }
    }
}

// MARK: - GalleryViewModel

@Observable
@MainActor
final class GalleryViewModel {
    // MARK: Данные
    let event: Event
    var photos: [Photo] = []
    var isLoading: Bool = false
    var errorMessage: String?

    // MARK: Фильтрация
    var selectedTab: GalleryTab = .all
    var selectedGuestId: String? = nil

    // MARK: Проявка
    var isRevealing: Bool = false
    var revealError: String?
    var showRevealConfirm: Bool = false

    init(event: Event) {
        self.event = event
    }

    // MARK: - Вычисляемые

    /// Уникальные guest_id для фильтра «По гостям»
    var guestIds: [String] {
        Array(Set(photos.map { $0.guestId })).sorted()
    }

    /// Фото с учётом выбранного таба и гостя
    var displayedPhotos: [Photo] {
        switch selectedTab {
        case .all:
            return photos
        case .byGuest:
            if let guestId = selectedGuestId {
                return photos.filter { $0.guestId == guestId }
            }
            return photos
        }
    }

    /// Показать плашку «Фото проявятся в HH:MM» (SPECIFICATION §9 case 4)
    var showRevealBanner: Bool {
        guard let revealAt = event.revealAt else { return false }
        return revealAt > Date() && event.status == .live
    }

    var revealBannerText: String {
        guard let revealAt = event.revealAt else { return "" }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.locale = Locale(identifier: "ru_RU")
        return "Фото проявятся в \(formatter.string(from: revealAt))"
    }

    var canReveal: Bool {
        event.status == .live || event.status == .draft
    }

    // MARK: - Загрузка

    func loadPhotos() async {
        isLoading = true
        errorMessage = nil
        do {
            photos = try await APIClient.shared.listPhotos(eventId: event.id)
        } catch {
            errorMessage = (error as? KadrError)?.userMessage ?? error.localizedDescription
        }
        isLoading = false
    }

    // MARK: - Проявка

    func revealNow() async {
        isRevealing = true
        revealError = nil
        do {
            _ = try await APIClient.shared.revealEvent(eventId: event.id)
        } catch {
            revealError = (error as? KadrError)?.userMessage ?? error.localizedDescription
        }
        isRevealing = false
    }

    // MARK: - Избранное

    func toggleFavorite(photo: Photo) async {
        let newValue = !photo.isFavorite
        do {
            try await APIClient.shared.setFavorite(photoId: photo.id, isFavorite: newValue)
            // Обновляем локально
            if let idx = photos.firstIndex(where: { $0.id == photo.id }) {
                let old = photos[idx]
                photos[idx] = Photo(
                    id: old.id,
                    eventId: old.eventId,
                    guestId: old.guestId,
                    filter: old.filter,
                    width: old.width,
                    height: old.height,
                    isFavorite: newValue,
                    uploaded: old.uploaded,
                    takenAt: old.takenAt
                )
            }
        } catch {
            errorMessage = (error as? KadrError)?.userMessage ?? error.localizedDescription
        }
    }

    // MARK: - Подписанный URL

    /// Возвращает подписанный URL фото.
    /// Фото отдаются только так — никаких публичных ссылок (152-ФЗ, SPECIFICATION §5).
    func signedURL(for photoId: String) async throws -> URL {
        let response = try await APIClient.shared.photoURL(photoId: photoId)
        guard let url = URL(string: response.url) else {
            throw KadrError.decodingError("Невалидный URL фото")
        }
        return url
    }
}
