import { FixtureExperience } from "../../../../components/FixtureExperience";
import { selectFixtureRole } from "../../../../features/experience/role-selection";

interface FixturePageProps {
  readonly searchParams: Promise<Readonly<{ role?: string | readonly string[] }>>;
}

export default async function MvpCoreFixturePage({ searchParams }: FixturePageProps) {
  const params = await searchParams;
  return <FixtureExperience selectedRole={selectFixtureRole(params.role)} />;
}
