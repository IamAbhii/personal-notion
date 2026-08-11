// The seed template: data, not SQL, so it is readable and reviewable and can be applied to any
// workspace. Ids are minted per call by seedWorkspace, never written here, so the same template can
// populate any number of workspaces without collisions.
//
// It grows with the phases: Phase 2 added `blocks` to these nodes, and a later phase adds a
// `databases` section alongside, so nothing ever ships empty. Keep the shape append-only.
import type { BlockType } from '../sync/ops';

// One block of page content. Order inside the array is the order on the page; seedWorkspace mints the
// fractional sort_keys. props is a JSON string for type-specific extras only.
export type SeedBlock = {
  type: BlockType;
  text?: string;
  checked?: boolean;
  props?: string;
};

export type SeedPage = {
  title: string;
  icon: string;
  blocks?: SeedBlock[];
  children?: SeedPage[];
};

// Written out in full on a few pages so a first run reads like a workspace someone actually keeps, and
// so every one of the eleven block types is visible without the user creating anything.
const INTENTIONS_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: '2026 Intentions' },
  {
    type: 'paragraph',
    text: 'Fewer, bigger things. Last year was a long list of small ones and none of them stuck.',
  },
  { type: 'heading2', text: 'The three that matter' },
  { type: 'todo', text: 'Finish the flat renovation, kitchen included', checked: false },
  { type: 'todo', text: 'Shoot one roll of film a month', checked: true },
  { type: 'todo', text: 'Two weeks in Japan, booked and paid for', checked: true },
  { type: 'divider' },
  {
    type: 'quote',
    text: 'You do not rise to the level of your goals, you fall to the level of your systems.',
  },
  { type: 'heading3', text: 'How I will check in' },
  { type: 'bulletedList', text: 'Sunday evening, ten minutes, in Weekly Review' },
  { type: 'bulletedList', text: 'One photo per month in the film log, no exceptions' },
  {
    type: 'callout',
    text: 'If a month goes by with no entry here, that is the signal to cut something.',
    props: '{"emoji":"\u{1F4A1}"}',
  },
];

const LIGHTING_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Lighting ideas' },
  {
    type: 'paragraph',
    text: 'The ceiling spots are too cold and too even. Layers instead: one bright source, two warm ones.',
  },
  { type: 'heading2', text: 'Shortlist' },
  { type: 'bulletedList', text: 'Paper shade pendant over the table, dimmable' },
  { type: 'bulletedList', text: 'Plaster wall sconces either side of the sofa' },
  { type: 'bulletedList', text: 'Floor lamp in the reading corner, 2700K' },
  { type: 'divider' },
  { type: 'heading3', text: 'Order of work' },
  { type: 'numberedList', text: 'Electrician confirms the sconce positions' },
  { type: 'numberedList', text: 'Chase the walls before the plasterer comes back' },
  { type: 'numberedList', text: 'Fittings last, once the paint is dry' },
  {
    type: 'callout',
    text: 'Nothing above 3000K anywhere in the flat. The last place was a hospital.',
    props: '{"emoji":"\u{26A0}\u{FE0F}"}',
  },
  { type: 'quote', text: 'Light the room, not the ceiling.' },
];

const FILM_STOCK_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Film stock notes' },
  {
    type: 'paragraph',
    text: 'What each stock actually looks like out of the lab I use, rather than what the box says.',
  },
  { type: 'heading2', text: 'Colour' },
  { type: 'bulletedList', text: 'Portra 400 - forgiving, warm skin, overexpose a stop' },
  { type: 'bulletedList', text: 'Gold 200 - green shifts in shade, lovely in late sun' },
  { type: 'heading2', text: 'Black and white' },
  { type: 'bulletedList', text: 'HP5 pushed to 1600 for indoors, grain is the point' },
  { type: 'heading3', text: 'Developing times I keep forgetting' },
  { type: 'numberedList', text: 'HP5 at 400 in DD-X: 9 minutes at 20C' },
  { type: 'numberedList', text: 'HP5 at 1600 in DD-X: 16 minutes at 20C' },
  { type: 'divider' },
  { type: 'todo', text: 'Scan the July rolls', checked: true },
  { type: 'todo', text: 'Reorder two rolls of Portra before the trip', checked: false },
  {
    type: 'paragraph',
    text: 'The renaming script for scans, so the negatives and the files stay in step:',
  },
  {
    type: 'code',
    text: "const name = (roll: string, frame: number) =>\n  `${roll}-${String(frame).padStart(2, '0')}.tif`;",
    props: '{"language":"typescript"}',
  },
  {
    type: 'callout',
    text: 'Frame numbers come from the negative sleeve, not from the scanner order.',
    props: '{"emoji":"\u{1F4CC}"}',
  },
];

// A page tree that reads like a real person's workspace: four top-level areas, four levels deep at
// the deepest, every page with an emoji icon.
export const SEED_PAGES: SeedPage[] = [
  {
    title: 'Home',
    icon: '🏠',
    blocks: [
      { type: 'heading2', text: 'Start here' },
      {
        type: 'paragraph',
        text: 'Everything lives under one of the four areas in the sidebar. This page is just the way in.',
      },
      { type: 'bulletedList', text: 'Journal for the weekly review and the yearly intentions' },
      { type: 'bulletedList', text: 'Projects for anything with an end date' },
      {
        type: 'callout',
        text: 'Press the slash key on an empty line to change what a block is.',
        props: '{"emoji":"\u{2728}"}',
      },
    ],
    children: [
      {
        title: 'Journal',
        icon: '📓',
        children: [
          { title: '2026 Intentions', icon: '🌱', blocks: INTENTIONS_BLOCKS },
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
              { title: 'Lighting ideas', icon: '💡', blocks: LIGHTING_BLOCKS },
              { title: 'Budget notes', icon: '💰' },
            ],
          },
          {
            title: 'Photography',
            icon: '📷',
            children: [{ title: 'Film stock notes', icon: '🎞️', blocks: FILM_STOCK_BLOCKS }],
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
          {
            title: 'Packing list',
            icon: '🎒',
            blocks: [
              { type: 'heading2', text: 'Carry on' },
              { type: 'todo', text: 'Passport and the JR pass voucher', checked: true },
              { type: 'todo', text: 'Camera, two rolls of Portra, spare battery', checked: false },
              { type: 'todo', text: 'Adapter - Japan is type A, 100V', checked: false },
              { type: 'quote', text: 'Pack half of what you laid out. You always do.' },
            ],
          },
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
