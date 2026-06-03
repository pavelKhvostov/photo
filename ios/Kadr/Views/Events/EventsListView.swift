import SwiftUI

// MARK: - EventsListView

/// Экран «Мои события» — список карточек событий хоста.
struct EventsListView: View {
    @State private var viewModel = EventsViewModel()
    @State private var showCreateEvent = false

    var body: some View {
        ZStack {
            KadrTheme.background.ignoresSafeArea()

            Group {
                if viewModel.isLoading && viewModel.events.isEmpty {
                    KadrProgressView()
                } else if let error = viewModel.errorMessage, viewModel.events.isEmpty {
                    errorView(message: error)
                } else if viewModel.events.isEmpty {
                    emptyStateView
                } else {
                    eventsList
                }
            }
        }
        .navigationTitle("Мои события")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showCreateEvent = true
                } label: {
                    Image(systemName: "plus")
                        .foregroundColor(KadrTheme.accent)
                        .font(.system(size: 18, weight: .semibold))
                }
            }
        }
        .sheet(isPresented: $showCreateEvent, onDismiss: {
            Task { await viewModel.loadEvents() }
        }) {
            CreateEventView()
        }
        .task {
            await viewModel.loadEvents()
        }
        .refreshable {
            await viewModel.loadEvents()
        }
    }

    // MARK: - Список

    private var eventsList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if let error = viewModel.errorMessage {
                    ErrorBanner(message: error)
                        .padding(.horizontal, KadrTheme.padding)
                }

                ForEach(viewModel.events) { event in
                    NavigationLink {
                        GalleryView(event: event)
                    } label: {
                        EventCardView(event: event)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, KadrTheme.padding)
                }
            }
            .padding(.vertical, KadrTheme.padding)
        }
    }

    // MARK: - Пустое состояние

    private var emptyStateView: some View {
        VStack(spacing: 20) {
            Image(systemName: "camera.aperture")
                .font(.system(size: 60))
                .foregroundColor(KadrTheme.textDisabled)

            Text("Нет событий")
                .font(KadrTheme.headingFont)
                .foregroundColor(KadrTheme.textPrimary)

            Text("Создайте первое событие, чтобы гости могли снимать и делиться кадрами.")
                .font(KadrTheme.bodyFont)
                .foregroundColor(KadrTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Button("Создать событие") {
                showCreateEvent = true
            }
            .buttonStyle(AccentButtonStyle())
            .padding(.horizontal, 40)
        }
    }

    // MARK: - Ошибка

    private func errorView(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(KadrTheme.error)

            Text("Не удалось загрузить события")
                .font(KadrTheme.headingFont)
                .foregroundColor(KadrTheme.textPrimary)

            Text(message)
                .font(KadrTheme.bodyFont)
                .foregroundColor(KadrTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Button("Повторить") {
                Task { await viewModel.loadEvents() }
            }
            .buttonStyle(AccentButtonStyle())
            .padding(.horizontal, 40)
        }
    }
}
