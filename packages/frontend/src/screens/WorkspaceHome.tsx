import { useWorkspace } from '../workspace/context';

/**
 * The workspace landing screen, shown when the workspace has no pages at all. When it has pages the
 * route redirects to the first one, so this is the genuinely empty case.
 */
export function WorkspaceHome() {
  const { createAndOpenPage } = useWorkspace();

  return (
    <main className="page">
      <section className="placeholder placeholder--welcome">
        <p className="placeholder__eyebrow">Personal Space</p>
        <p className="placeholder__lead">Nothing here yet.</p>
        <p className="placeholder__note">
          Create your first page and it becomes the top of your tree. Nest as deep as you like.
        </p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => createAndOpenPage(null)}
        >
          Create a page
        </button>
      </section>
    </main>
  );
}
