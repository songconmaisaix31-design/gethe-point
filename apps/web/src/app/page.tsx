import { ExperienceShell } from "../components/experience-shell";
import {
  resolveExperienceRoute,
  type ExperienceSearchParams,
} from "../features/experience/model";

interface HomePageProps {
  readonly searchParams: Promise<ExperienceSearchParams>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const route = resolveExperienceRoute(await searchParams);

  return <ExperienceShell route={route} />;
}
