import TestSimulationPage from "@/lib/routes/test-simulations-page";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test/simulations");

export default async function TestSimulationsPage() {
  return (
    <div
      data-confirmation-fields="workspace.stage.draft.canAutoApply workspace.stage.draft.requiresUserConfirmation"
      data-risk-surface="阶段计划"
    >
      {await TestSimulationPage()}
    </div>
  );
}
