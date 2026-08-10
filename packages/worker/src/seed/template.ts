// The seed template: data, not SQL, so it is readable and reviewable and can be applied to any
// workspace. Ids are minted per call by seedWorkspace, never written here, so the same template can
// populate any number of workspaces without collisions.
//
// It grows with the phases: later phases add `blocks` to these nodes and a `databases` section
// alongside, so nothing ever ships empty. Keep the shape append-only.

export type SeedPage = {
  title: string;
  icon: string;
  children?: SeedPage[];
};

// A page tree that reads like a real person's workspace: four top-level areas, four levels deep at
// the deepest, every page with an emoji icon.
export const SEED_PAGES: SeedPage[] = [
  {
    title: 'Home',
    icon: '🏠',
    children: [
      {
        title: 'Journal',
        icon: '📓',
        children: [
          { title: '2026 Intentions', icon: '🌱' },
          {
            title: 'Weekly Review',
            icon: '🗓️',
            children: [
              { title: 'Week 32 - what worked', icon: '✅' },
              { title: 'Week 32 - what to drop', icon: '🧹' },
            ],
          },
        ],
      },
      {
        title: 'Projects',
        icon: '🧭',
        children: [
          {
            title: 'Flat Renovation',
            icon: '🏡',
            children: [
              { title: 'Lighting ideas', icon: '💡' },
              { title: 'Budget notes', icon: '💰' },
            ],
          },
          {
            title: 'Photography',
            icon: '📷',
            children: [{ title: 'Film stock notes', icon: '🎞️' }],
          },
        ],
      },
      { title: 'Someday, maybe', icon: '🛸' },
    ],
  },
  {
    title: 'Recipes',
    icon: '🍜',
    children: [
      {
        title: 'Weeknight dinners',
        icon: '🥗',
        children: [
          { title: 'Miso noodle soup', icon: '🍲' },
          { title: 'Sheet pan chicken', icon: '🍗' },
        ],
      },
      {
        title: 'Baking',
        icon: '🍞',
        children: [{ title: 'Sourdough log', icon: '🥖' }],
      },
    ],
  },
  {
    title: 'Travel',
    icon: '✈️',
    children: [
      {
        title: 'Japan 2027',
        icon: '🗾',
        children: [
          { title: 'Kyoto shortlist', icon: '🏯' },
          { title: 'Packing list', icon: '🎒' },
        ],
      },
    ],
  },
  {
    title: 'Reading list',
    icon: '📚',
    children: [{ title: 'Finished in 2026', icon: '📖' }],
  },
];
