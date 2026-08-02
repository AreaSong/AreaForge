import SimulationExamPage from "@/lib/routes/test-simulation-detail-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test/simulations/exam");

export default async function TestSimulationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  return SimulationExamPage({ params, searchParams });
}
