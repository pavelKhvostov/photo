import SwiftUI

// MARK: - TariffView

/// Заглушка экрана тарифа.
/// TODO: при нажатии «Оплатить» → POST /functions/v1/billing-checkout → WebView ЮKassa.
/// Тарифная сетка — из таблицы plans (цены не хардкодятся, SPECIFICATION §1).
struct TariffView: View {
    var body: some View {
        ZStack {
            KadrTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 20) {
                    Text("Тарифы")
                        .font(KadrTheme.titleFont)
                        .foregroundColor(KadrTheme.textPrimary)

                    ForEach(PlanCode.allCases, id: \.rawValue) { plan in
                        planCard(plan)
                    }

                    Text("Оплата через ЮKassa и СБП (РФ).")
                        .font(KadrTheme.captionFont)
                        .foregroundColor(KadrTheme.textDisabled)

                    // TODO: WebView ЮKassa (после реализации /billing/checkout)
                    Text("Подключение оплаты — следующая фаза разработки.")
                        .font(KadrTheme.captionFont)
                        .foregroundColor(KadrTheme.textDisabled)
                        .multilineTextAlignment(.center)
                }
                .padding(KadrTheme.padding)
            }
        }
        .navigationTitle("Тарифы")
    }

    private func planCard(_ plan: PlanCode) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(plan.displayName)
                .font(KadrTheme.headingFont)
                .foregroundColor(KadrTheme.textPrimary)

            Text(planDescription(plan))
                .font(KadrTheme.bodyFont)
                .foregroundColor(KadrTheme.textSecondary)
        }
        .padding(KadrTheme.padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
        .overlay(
            RoundedRectangle(cornerRadius: KadrTheme.cornerRadius)
                .stroke(KadrTheme.separator, lineWidth: 1)
        )
    }

    private func planDescription(_ plan: PlanCode) -> String {
        switch plan {
        case .free:      return "10 гостей, 20 кадров, 7 дней хранения"
        case .party:     return "50 гостей, 50 кадров, 90 дней хранения"
        case .wedding:   return "150 гостей, без лимита кадров, 365 дней"
        case .unlimited: return "100 000 гостей, без лимита, 365 дней"
        }
    }
}

// MARK: - PlanCode: CaseIterable

extension PlanCode: CaseIterable {
    public static var allCases: [PlanCode] { [.free, .party, .wedding, .unlimited] }
}
