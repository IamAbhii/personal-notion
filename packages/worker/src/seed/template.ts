// The seed template: data, not SQL, so it is readable and reviewable and can be applied to any
// workspace. Ids are minted per call by seedWorkspace, never written here, so the same template can
// populate any number of workspaces without collisions.
//
// It grows with the phases: Phase 2 added `blocks` to these nodes, Phase 3 added `databases`, and
// Phase 4 adds `views`. Keep the shape append-only.
import type { BlockType, FilterOperator, OptionColor, PropertyType } from '../sync/ops';

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

// A property definition inside a database template. options is only meaningful for select and
// multiSelect types; id is omitted here and minted by seedWorkspace so options can vary per workspace.
export type SeedPropertyDef = {
  name: string;
  type: PropertyType;
  options?: Array<{ name: string; color: OptionColor }>;
};

// One row in a seeded database. values maps property name to the JS value (not JSON-encoded); the
// seed encoder converts it to the appropriate JSON string before inserting.
export type SeedRowDef = {
  title: string;
  blocks?: SeedBlock[];
  values?: Array<{ propertyName: string; value: unknown }>;
};

// One filter condition in a seeded view. propertyName is resolved to the property id by
// seedWorkspace; operator must be legal for the property type it targets.
export type SeedViewFilterDef = {
  propertyName: string;
  operator: FilterOperator;
  value: string | null;
};

// A sort condition in a seeded view. propertyName may be 'title' or the name of any property on
// the same database.
export type SeedViewSortDef = {
  propertyName: string;
  direction: 'asc' | 'desc';
};

// A view definition for a seeded database. groupPropertyName must be the name of a select property
// on the same database (board views only).
export type SeedViewDef = {
  name: string;
  kind: 'table' | 'board' | 'list';
  groupPropertyName?: string;
  filters?: SeedViewFilterDef[];
  sort?: SeedViewSortDef;
};

// A database page with its property schema, initial rows and default views.
export type SeedDatabaseDef = {
  title: string;
  icon: string;
  properties: SeedPropertyDef[];
  rows: SeedRowDef[];
  // Three views per database (table, board, list). Absent in pre-Phase-4 seeds.
  views?: SeedViewDef[];
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

// Two databases that exercise all seven property types between them, with colored select and
// multiSelect options and several realistic rows.
//
// "Work Projects" uses: select (status), multiSelect (tags), date (due), checkbox (done),
//   number (effort), url (spec).
// "Book Tracker" uses: select (status), multiSelect (topics), url (link), date (finished),
//   number (rating), text (notes).
//
// Together they cover all seven property types (text, number, select, multiSelect, date, checkbox, url).
export const SEED_DATABASES: SeedDatabaseDef[] = [
  {
    title: 'Work Projects',
    icon: '🗂️',
    properties: [
      {
        name: 'Status',
        type: 'select',
        options: [
          { name: 'Backlog', color: 'gray' },
          { name: 'In progress', color: 'blue' },
          { name: 'Done', color: 'teal' },
          { name: 'On hold', color: 'amber' },
        ],
      },
      {
        name: 'Tags',
        type: 'multiSelect',
        options: [
          { name: 'Frontend', color: 'purple' },
          { name: 'Backend', color: 'blue' },
          { name: 'Design', color: 'rose' },
          { name: 'Research', color: 'amber' },
        ],
      },
      { name: 'Due date', type: 'date' },
      { name: 'Done', type: 'checkbox' },
      { name: 'Effort (days)', type: 'number' },
      { name: 'Spec', type: 'url' },
    ],
    rows: [
      {
        title: 'Phase 3: databases and table view',
        blocks: [
          { type: 'heading2', text: 'Scope' },
          { type: 'paragraph', text: 'Add database pages, properties and the table view.' },
          { type: 'todo', text: 'Migration and Drizzle schema', checked: true },
          { type: 'todo', text: 'Op handlers in apply.ts', checked: false },
          { type: 'todo', text: 'Table view component', checked: false },
        ],
        values: [
          { propertyName: 'Status', value: 'In progress' },
          { propertyName: 'Tags', value: ['Frontend', 'Backend'] },
          { propertyName: 'Due date', value: '2026-09-15' },
          { propertyName: 'Done', value: false },
          { propertyName: 'Effort (days)', value: 5 },
          { propertyName: 'Spec', value: 'github.com/org/spec/phase-3' },
        ],
      },
      {
        title: 'Accessibility audit',
        blocks: [
          { type: 'paragraph', text: 'Screen reader pass on the sidebar and the editor.' },
          { type: 'todo', text: 'Run axe on all routes', checked: false },
        ],
        values: [
          { propertyName: 'Status', value: 'Backlog' },
          { propertyName: 'Tags', value: ['Design', 'Frontend'] },
          { propertyName: 'Due date', value: '2026-10-01' },
          { propertyName: 'Done', value: false },
          { propertyName: 'Effort (days)', value: 3 },
        ],
      },
      {
        title: 'Performance baseline',
        blocks: [{ type: 'paragraph', text: 'Measure cold-start and snapshot load times.' }],
        values: [
          { propertyName: 'Status', value: 'Done' },
          { propertyName: 'Tags', value: ['Backend'] },
          { propertyName: 'Due date', value: '2026-08-01' },
          { propertyName: 'Done', value: true },
          { propertyName: 'Effort (days)', value: 2 },
          { propertyName: 'Spec', value: 'notion.so/perf-baseline' },
        ],
      },
      // Two extra rows added for Phase 4 board viability: every Status column gets at least one
      // card, one column gets a second card, and one row has no Status (uncategorised column).
      {
        title: 'API documentation',
        blocks: [
          { type: 'paragraph', text: 'Document every endpoint in the OpenAPI schema.' },
          { type: 'todo', text: 'Sync and snapshot endpoints', checked: false },
          { type: 'todo', text: 'Auth flow and session lifecycle', checked: false },
        ],
        values: [
          { propertyName: 'Status', value: 'On hold' },
          { propertyName: 'Tags', value: ['Backend'] },
          { propertyName: 'Due date', value: '2026-11-01' },
          { propertyName: 'Done', value: false },
          { propertyName: 'Effort (days)', value: 3 },
        ],
      },
      {
        title: 'Mobile layout pass',
        blocks: [{ type: 'paragraph', text: 'Check every view at 375px viewport width.' }],
        values: [
          { propertyName: 'Status', value: 'Backlog' },
          { propertyName: 'Tags', value: ['Frontend', 'Design'] },
          { propertyName: 'Due date', value: '2026-10-15' },
          { propertyName: 'Done', value: false },
          { propertyName: 'Effort (days)', value: 4 },
        ],
      },
      // No Status — exercises the uncategorised column on the board view.
      {
        title: 'Offline sync queue',
        blocks: [
          { type: 'paragraph', text: 'Phase 6 work: the durable IndexedDB queue and flush loop.' },
        ],
        values: [
          { propertyName: 'Tags', value: ['Frontend', 'Backend'] },
          { propertyName: 'Effort (days)', value: 8 },
        ],
      },
    ],
    // Three views: table (default), board grouped by Status, list filtered to active work only.
    views: [
      { name: 'Table', kind: 'table' },
      { name: 'Board', kind: 'board', groupPropertyName: 'Status' },
      {
        name: 'List',
        kind: 'list',
        // Show only items that are not yet marked done, so the list stays useful as a to-do view.
        filters: [{ propertyName: 'Done', operator: 'isNotChecked', value: null }],
      },
    ],
  },
  {
    title: 'Book Tracker',
    icon: '📖',
    properties: [
      {
        name: 'Status',
        type: 'select',
        options: [
          { name: 'Want to read', color: 'gray' },
          { name: 'Reading', color: 'amber' },
          { name: 'Finished', color: 'teal' },
          { name: 'Abandoned', color: 'rose' },
        ],
      },
      {
        name: 'Topics',
        type: 'multiSelect',
        options: [
          { name: 'Design', color: 'purple' },
          { name: 'Technology', color: 'blue' },
          { name: 'History', color: 'amber' },
          { name: 'Fiction', color: 'teal' },
          { name: 'Science', color: 'rose' },
        ],
      },
      { name: 'Link', type: 'url' },
      { name: 'Finished', type: 'date' },
      { name: 'Rating', type: 'number' },
      { name: 'Notes', type: 'text' },
    ],
    rows: [
      {
        title: 'The Design of Everyday Things',
        blocks: [
          {
            type: 'paragraph',
            text: 'Norman doors and affordances. Every designer should read this.',
          },
        ],
        values: [
          { propertyName: 'Status', value: 'Finished' },
          { propertyName: 'Topics', value: ['Design'] },
          { propertyName: 'Link', value: 'bookshop.org/p/books/the-design-of-everyday-things' },
          { propertyName: 'Finished', value: '2026-03-12' },
          { propertyName: 'Rating', value: 5 },
          {
            propertyName: 'Notes',
            value: 'Reread the visibility and feedback chapters before the next project.',
          },
        ],
      },
      {
        title: 'A Philosophy of Software Design',
        blocks: [
          { type: 'paragraph', text: 'Ousterhout on complexity and deep modules.' },
          {
            type: 'todo',
            text: 'Apply the deep-module principle to the repo layer',
            checked: false,
          },
        ],
        values: [
          { propertyName: 'Status', value: 'Reading' },
          { propertyName: 'Topics', value: ['Technology'] },
          { propertyName: 'Rating', value: 4 },
          { propertyName: 'Notes', value: 'Chapter 8 on pull complexity up is the key insight.' },
        ],
      },
      {
        title: 'The Pragmatic Programmer',
        blocks: [],
        values: [
          { propertyName: 'Status', value: 'Want to read' },
          { propertyName: 'Topics', value: ['Technology'] },
          { propertyName: 'Link', value: 'pragprog.com/titles/tpp20' },
        ],
      },
      // Two extra rows for Phase 4 board viability: Abandoned column gets a card, Want to read
      // gets a second card, and one row has no Status (uncategorised column).
      {
        title: 'The Lean Startup',
        blocks: [
          {
            type: 'paragraph',
            text: 'Abandoned after chapter 3 — found the build-measure-learn cycle already familiar.',
          },
        ],
        values: [
          { propertyName: 'Status', value: 'Abandoned' },
          { propertyName: 'Topics', value: ['Technology'] },
          { propertyName: 'Rating', value: 2 },
        ],
      },
      {
        title: 'Structure and Interpretation of Computer Programs',
        blocks: [],
        values: [
          { propertyName: 'Status', value: 'Want to read' },
          { propertyName: 'Topics', value: ['Technology', 'Science'] },
          { propertyName: 'Link', value: 'mitpress.mit.edu/9780262510875' },
        ],
      },
      // No Status — exercises the uncategorised column on the board view.
      {
        title: 'Thinking, Fast and Slow',
        blocks: [{ type: 'paragraph', text: 'On the reading pile.' }],
        values: [{ propertyName: 'Topics', value: ['Science'] }],
      },
    ],
    // Three views: table (default), board grouped by Status, list sorted by rating highest first.
    views: [
      { name: 'Table', kind: 'table' },
      { name: 'Board', kind: 'board', groupPropertyName: 'Status' },
      {
        name: 'List',
        kind: 'list',
        // Descending rating puts the best-rated books at the top of the reading list view.
        sort: { propertyName: 'Rating', direction: 'desc' },
      },
    ],
  },
];
