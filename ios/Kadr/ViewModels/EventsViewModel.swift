import Foundation
import Observation

// MARK: - EventsViewModel

@Observable
@MainActor
final class EventsViewModel {
    // MARK: Состояние
    var events: [Event] = []
    var isLoading: Bool = false
    var errorMessage: String?

    // MARK: - Загрузка

    func loadEvents() async {
        isLoading = true
        errorMessage = nil
        do {
            events = try await APIClient.shared.listEvents()
        } catch {
            errorMessage = (error as? KadrError)?.userMessage ?? error.localizedDescription
        }
        isLoading = false
    }
}
