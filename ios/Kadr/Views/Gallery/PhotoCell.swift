import SwiftUI

// MARK: - PhotoCell

/// Ячейка сетки галереи. Загружает подписанный URL через APIClient и показывает через AsyncImage.
/// Публичных URL не хранится — только подписанные (152-ФЗ, SPECIFICATION §5).
struct PhotoCell: View {
    let photo: Photo
    let onFavoriteTap: () -> Void
    let signedURL: (String) async throws -> URL

    @State private var imageURL: URL?
    @State private var loadError: Bool = false
    @State private var isLoadingURL: Bool = false

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottomTrailing) {
                // Изображение
                imageContent(size: geo.size)

                // Кнопка «Избранное»
                favoriteButton
                    .padding(6)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipped()
        .task {
            await loadSignedURL()
        }
    }

    // MARK: - Изображение

    @ViewBuilder
    private func imageContent(size: CGSize) -> some View {
        if let url = imageURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .empty:
                    loadingPlaceholder
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(width: size.width, height: size.height)
                        .clipped()
                case .failure:
                    errorPlaceholder
                @unknown default:
                    loadingPlaceholder
                }
            }
        } else if isLoadingURL {
            loadingPlaceholder
        } else if loadError {
            errorPlaceholder
        } else {
            loadingPlaceholder
        }
    }

    private var loadingPlaceholder: some View {
        Rectangle()
            .fill(KadrTheme.surface)
            .overlay(KadrProgressView())
    }

    private var errorPlaceholder: some View {
        Rectangle()
            .fill(KadrTheme.surface)
            .overlay(
                Image(systemName: "photo.slash")
                    .foregroundColor(KadrTheme.textDisabled)
            )
    }

    // MARK: - Кнопка избранное

    private var favoriteButton: some View {
        Button {
            onFavoriteTap()
        } label: {
            Image(systemName: photo.isFavorite ? "heart.fill" : "heart")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(photo.isFavorite ? KadrTheme.error : .white)
                .shadow(radius: 2)
                .padding(8)
                .background(
                    Circle()
                        .fill(Color.black.opacity(0.35))
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Загрузка подписанного URL

    /// Запрашивает подписанный URL у APIClient.
    /// Фото отдаются только так — никаких публичных ссылок (152-ФЗ).
    private func loadSignedURL() async {
        guard imageURL == nil, !isLoadingURL else { return }
        isLoadingURL = true
        loadError = false
        do {
            imageURL = try await signedURL(photo.id)
        } catch {
            loadError = true
        }
        isLoadingURL = false
    }
}
