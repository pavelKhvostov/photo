import SwiftUI

// MARK: - QRShareView

/// Экран «QR / Поделиться».
/// QR генерируется локально через CIQRCodeGenerator — без зависимости от сети.
struct QRShareView: View {
    let joinUrl: String
    let shortCode: String

    @State private var viewModel: QRViewModel
    @State private var showShareSheet = false
    @Environment(\.dismiss) private var dismiss

    init(joinUrl: String, shortCode: String) {
        self.joinUrl = joinUrl
        self.shortCode = shortCode
        _viewModel = State(initialValue: QRViewModel(joinUrl: joinUrl, shortCode: shortCode))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                KadrTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 28) {
                        // Подзаголовок
                        VStack(spacing: 8) {
                            Text("Пригласите гостей")
                                .font(KadrTheme.headingFont)
                                .foregroundColor(KadrTheme.textPrimary)

                            Text("Гости сканируют QR или переходят по ссылке — без установки приложения")
                                .font(KadrTheme.captionFont)
                                .foregroundColor(KadrTheme.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.horizontal, KadrTheme.padding)

                        // QR-код
                        qrCodeSection

                        // Ссылка
                        linkSection

                        // Кнопка поделиться
                        shareButton
                    }
                    .padding(.vertical, KadrTheme.paddingLarge)
                }
            }
            .navigationTitle("QR и ссылка")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Готово") {
                        dismiss()
                    }
                    .foregroundColor(KadrTheme.accent)
                }
            }
            .sheet(isPresented: $showShareSheet) {
                ShareSheetView(items: viewModel.shareItems)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    // MARK: - QR-код

    private var qrCodeSection: some View {
        Group {
            if let image = viewModel.qrImage {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 220, height: 220)
                    .padding(16)
                    .background(
                        RoundedRectangle(cornerRadius: KadrTheme.cornerRadius)
                            .fill(Color.white)  // QR всегда на белом фоне для читаемости
                    )
                    .padding(.horizontal, KadrTheme.padding)
            } else {
                RoundedRectangle(cornerRadius: KadrTheme.cornerRadius)
                    .fill(KadrTheme.surface)
                    .frame(width: 220, height: 220)
                    .overlay(
                        VStack(spacing: 8) {
                            Image(systemName: "qrcode")
                                .font(.system(size: 40))
                                .foregroundColor(KadrTheme.textDisabled)
                            Text("Ошибка генерации QR")
                                .font(KadrTheme.captionFont)
                                .foregroundColor(KadrTheme.textDisabled)
                        }
                    )
            }
        }
    }

    // MARK: - Ссылка

    private var linkSection: some View {
        VStack(spacing: 8) {
            Text("Ссылка для гостей")
                .font(KadrTheme.captionFont)
                .foregroundColor(KadrTheme.textSecondary)

            HStack {
                Text(joinUrl)
                    .font(KadrTheme.bodyFont)
                    .foregroundColor(KadrTheme.accent)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer()

                Button {
                    UIPasteboard.general.string = joinUrl
                } label: {
                    Image(systemName: "doc.on.doc")
                        .foregroundColor(KadrTheme.textSecondary)
                }
                .buttonStyle(.plain)
            }
            .padding(KadrTheme.padding)
            .cardStyle()
            .padding(.horizontal, KadrTheme.padding)
        }
    }

    // MARK: - Кнопка поделиться

    private var shareButton: some View {
        Button {
            showShareSheet = true
        } label: {
            Label("Поделиться", systemImage: "square.and.arrow.up")
        }
        .buttonStyle(AccentButtonStyle())
        .padding(.horizontal, KadrTheme.padding)
    }
}

// MARK: - ShareSheetView (UIActivityViewController обёртка)

/// UIViewControllerRepresentable обёртка для UIActivityViewController (системный share sheet).
struct ShareSheetView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
