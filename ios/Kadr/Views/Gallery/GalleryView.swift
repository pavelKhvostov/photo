import SwiftUI

// MARK: - GalleryView

/// Галерея события: сетка фото, табы «Все / По гостям», избранное, проявка.
/// До проявки — плашка «Фото проявятся в HH:MM» (SPECIFICATION §9 case 4).
struct GalleryView: View {
    @State private var viewModel: GalleryViewModel

    init(event: Event) {
        _viewModel = State(initialValue: GalleryViewModel(event: event))
    }

    var body: some View {
        @Bindable var vm = viewModel

        ZStack {
            KadrTheme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                if viewModel.showRevealBanner {
                    revealBanner
                }

                // Таб-пикер использует Binding через @Bindable vm
                Picker("", selection: $vm.selectedTab) {
                    ForEach(GalleryTab.allCases) { tab in
                        Text(tab.displayName).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding(KadrTheme.padding)
                .tint(KadrTheme.accent)

                if viewModel.selectedTab == .byGuest && !viewModel.guestIds.isEmpty {
                    guestPicker
                }

                galleryBody
            }
        }
        .navigationTitle(viewModel.event.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .task {
            await viewModel.loadPhotos()
        }
        .refreshable {
            await viewModel.loadPhotos()
        }
        .alert("Проявить галерею?", isPresented: $vm.showRevealConfirm) {
            Button("Проявить", role: .destructive) {
                Task { await viewModel.revealNow() }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Все гости увидят общую галерею прямо сейчас. Это действие нельзя отменить.")
        }
        .alert("Ошибка проявки", isPresented: Binding(
            get: { viewModel.revealError != nil },
            set: { if !$0 { viewModel.revealError = nil } }
        )) {
            Button("OK") {}
        } message: {
            Text(viewModel.revealError ?? "")
        }
    }

    // MARK: - Плашка до проявки

    private var revealBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "clock.fill")
                .foregroundColor(KadrTheme.accent)
            Text(viewModel.revealBannerText)
                .font(KadrTheme.captionFont)
                .foregroundColor(KadrTheme.textPrimary)
            Spacer()
        }
        .padding(.horizontal, KadrTheme.padding)
        .padding(.vertical, 10)
        .background(KadrTheme.accentDim)
    }

    // MARK: - Выбор гостя

    private var guestPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                guestChip(id: nil, label: "Все")
                ForEach(viewModel.guestIds, id: \.self) { guestId in
                    guestChip(id: guestId, label: String(guestId.prefix(8)))
                }
            }
            .padding(.horizontal, KadrTheme.padding)
        }
        .padding(.bottom, 8)
    }

    private func guestChip(id: String?, label: String) -> some View {
        let isSelected = viewModel.selectedGuestId == id
        return Button(label) {
            viewModel.selectedGuestId = id
        }
        .font(KadrTheme.captionFont)
        .foregroundColor(isSelected ? KadrTheme.background : KadrTheme.textPrimary)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Capsule().fill(isSelected ? KadrTheme.accent : KadrTheme.surface))
        .buttonStyle(.plain)
    }

    // MARK: - Тело галереи

    @ViewBuilder
    private var galleryBody: some View {
        if viewModel.isLoading && viewModel.photos.isEmpty {
            Spacer()
            KadrProgressView()
            Spacer()
        } else if let error = viewModel.errorMessage, viewModel.photos.isEmpty {
            Spacer()
            errorView(message: error)
            Spacer()
        } else if viewModel.displayedPhotos.isEmpty {
            Spacer()
            emptyView
            Spacer()
        } else {
            PhotoGridView(
                photos: viewModel.displayedPhotos,
                onFavoriteTap: { photo in
                    Task { await viewModel.toggleFavorite(photo: photo) }
                },
                signedURL: { photoId in
                    try await viewModel.signedURL(for: photoId)
                }
            )
        }
    }

    // MARK: - Тулбар

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if viewModel.canReveal {
                Button {
                    viewModel.showRevealConfirm = true
                } label: {
                    if viewModel.isRevealing {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .scaleEffect(0.7)
                            .tint(KadrTheme.accent)
                    } else {
                        Image(systemName: "wand.and.stars")
                            .foregroundColor(KadrTheme.accent)
                    }
                }
                .disabled(viewModel.isRevealing)
            }
        }
    }

    // MARK: - Пустое состояние

    private var emptyView: some View {
        VStack(spacing: 16) {
            Image(systemName: "photo.stack")
                .font(.system(size: 48))
                .foregroundColor(KadrTheme.textDisabled)
            Text("Пока нет кадров")
                .font(KadrTheme.headingFont)
                .foregroundColor(KadrTheme.textPrimary)
            Text("Гости ещё не сняли ни одного кадра.")
                .font(KadrTheme.bodyFont)
                .foregroundColor(KadrTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: - Ошибка

    private func errorView(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(KadrTheme.error)
            Text("Не удалось загрузить галерею")
                .font(KadrTheme.headingFont)
                .foregroundColor(KadrTheme.textPrimary)
            Text(message)
                .font(KadrTheme.bodyFont)
                .foregroundColor(KadrTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Button("Повторить") {
                Task { await viewModel.loadPhotos() }
            }
            .buttonStyle(AccentButtonStyle())
            .padding(.horizontal, 40)
        }
    }
}
