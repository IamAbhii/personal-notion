import { useWorkspace } from '../workspace/context';
import { StatusCard } from '../components/ui/StatusCard/StatusCard';
import { Button } from '../components/ui/Button/Button';

/**
 * The workspace landing screen, shown when the workspace has no pages at all. When it has pages the
 * route redirects to the first one, so this is the genuinely empty case.
 */
export function WorkspaceHome() {
  const { createAndOpenPage } = useWorkspace();

  return (
    <main className="mx-auto max-w-[860px] px-4 pt-6 pb-24 sm:px-8 md:px-14">
      {/* bordered variant matches the original placeholder--welcome shell: surface bg, panel shadow,
          solid border. mt-8 replaces the original margin-top: 34px on .placeholder. */}
      <StatusCard
        variant="bordered"
        eyebrowIntent="info"
        eyebrow="Personal Space"
        lead="Nothing here yet."
        note="Create your first page and it becomes the top of your tree. Nest as deep as you like."
        className="mt-8"
      >
        {/* mt-5 matches the original .placeholder--welcome .button { margin-top: 20px } rule. */}
        <Button className="mt-5" onClick={() => createAndOpenPage(null)}>
          Create a page
        </Button>
      </StatusCard>
    </main>
  );
}
