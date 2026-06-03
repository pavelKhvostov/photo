import SwiftUI

// MARK: - PhotoGridView

/// Сетка фото с ленивой загрузкой (LazyVGrid).
struct PhotoGridView: View {
    let photos: [Photo]
    let onFavoriteTap: (Photo) -> Void
    let signedURL: (String) async throws -> URL

    private let columns = [
        GridItem(.flexible(), spacing: 2),
        GridItem(.flexible(), spacing: 2),
        GridItem(.flexible(), spacing: 2)
    ]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(photos) { photo in
                    PhotoCell(
                        photo: photo,
                        onFavoriteTap: { onFavoriteTap(photo) },
                        signedURL: signedURL
                    )
                }
            }
        }
    }
}
