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
// so every one of the thirteen block types is visible without the user creating anything.
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
  { type: 'toggleList', text: 'Things I considered and set aside' },
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
  {
    type: 'image',
    props: '{"src":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgNDAwIDIwMCI+PHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNlNWU3ZWIiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYiIGZpbGw9IiM2YjcyODAiPkZpbG0gbm90ZXMgcGhvdG88L3RleHQ+PC9zdmc+"}',
  },
];

// Journal section — the journaling habit and its two rhythms.
const JOURNAL_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Journal' },
  {
    type: 'paragraph',
    text: 'Two rhythms: a weekly review on Sunday evenings and a yearly intentions page at the start of January. The weekly review keeps the week honest; the intentions page keeps the year from disappearing.',
  },
  { type: 'heading2', text: 'The habit' },
  { type: 'bulletedList', text: 'Sunday evening, half an hour, no phone' },
  { type: 'bulletedList', text: 'Each review has two pages: what worked and what to drop' },
  { type: 'bulletedList', text: 'Intentions revisited at the end of each quarter' },
];

// Weekly Review — the fixed format that keeps the half hour from becoming a wander.
const WEEKLY_REVIEW_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Weekly Review' },
  { type: 'paragraph', text: 'A fixed format so the half hour does not become a wander.' },
  { type: 'heading2', text: 'The format' },
  { type: 'bulletedList', text: 'What worked — one or two things, specific, not general' },
  { type: 'bulletedList', text: 'What to drop — one thing that cost more than it gave' },
  { type: 'bulletedList', text: 'What to carry into next week — one commitment, no more' },
  {
    type: 'callout',
    text: 'Keep it to thirty minutes. If it takes longer, something is wrong.',
    props: '{"emoji":"\u{23F0}"}',
  },
];

// Week 32 review — what went well.
const WEEK_32_WORKED_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Week 32 — what worked' },
  { type: 'heading2', text: 'The two things' },
  {
    type: 'bulletedList',
    text: 'Morning sessions before opening the laptop — kept four out of five days',
  },
  { type: 'bulletedList', text: 'Moving the renovation call to Thursday freed Monday completely' },
  { type: 'todo', text: 'Send the electrician the sconce measurements', checked: true },
  { type: 'todo', text: 'Book the darkroom slot for August', checked: false },
  { type: 'heading3', text: 'What to carry forward' },
  {
    type: 'paragraph',
    text: 'The morning block. It is the only part of the day that does not get interrupted.',
  },
];

// Week 32 review — what to drop.
const WEEK_32_DROP_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Week 32 — what to drop' },
  { type: 'heading2', text: 'The one thing' },
  {
    type: 'bulletedList',
    text: 'Checking email before the morning session — broke focus three times this week',
  },
  {
    type: 'paragraph',
    text: 'Phone goes face-down until the first session ends. That is the rule for next week.',
  },
  { type: 'todo', text: 'Turn off email notifications until 10am', checked: false },
];

// Projects section — the container for anything with a defined end date.
const PROJECTS_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Projects' },
  {
    type: 'paragraph',
    text: 'Anything with a defined end date and more than two steps. Ideas without a date go to Someday maybe.',
  },
  { type: 'heading2', text: 'Active' },
  { type: 'bulletedList', text: 'Flat Renovation — kitchen phase starting September' },
  { type: 'bulletedList', text: 'Photography — one roll a month through to the end of the year' },
  {
    type: 'callout',
    text: 'If a project has no next action, it is not a project — it is a worry.',
    props: '{"emoji":"\u{1F9ED}"}',
  },
];

// Flat Renovation — project overview and current state.
const FLAT_RENOVATION_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Flat Renovation' },
  {
    type: 'paragraph',
    text: 'Bought end of 2024. The original plan was six months. It is now month eighteen. The flat is liveable but unfinished.',
  },
  { type: 'heading2', text: 'What is left' },
  { type: 'todo', text: 'Kitchen — new worktop and appliances', checked: false },
  { type: 'todo', text: 'Living room lighting (see Lighting ideas)', checked: false },
  { type: 'todo', text: 'Hall floor — the one section still on bare concrete', checked: false },
  { type: 'heading3', text: 'Done' },
  { type: 'bulletedList', text: 'All electrics rewired' },
  { type: 'bulletedList', text: 'Bathroom retiled and replumbed' },
  { type: 'bulletedList', text: 'Bedroom and hall painted' },
];

// Budget notes — running total against the original quote.
const BUDGET_NOTES_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Budget notes' },
  {
    type: 'paragraph',
    text: 'Running total against the original quote. The original quote was optimistic in the way all original quotes are.',
  },
  { type: 'heading2', text: 'Actuals so far' },
  { type: 'numberedList', text: 'Electrics — £4,200 (quoted £3,800)' },
  { type: 'numberedList', text: 'Plastering — £1,600 (on budget)' },
  { type: 'numberedList', text: 'Bathroom — £3,900 (quoted £3,500)' },
  { type: 'numberedList', text: 'Paint and materials — £800' },
  { type: 'heading3', text: 'Still to come' },
  { type: 'todo', text: 'Get three kitchen quotes before end of August', checked: false },
  { type: 'todo', text: 'Lighting fittings — budget £800', checked: false },
  {
    type: 'callout',
    text: 'Total so far: £10,500. Original total budget: £16,000. Remaining: £5,500 before overspend.',
    props: '{"emoji":"\u{1F4B7}"}',
  },
];

// Photography project — the one-roll-a-month habit and its log.
const PHOTOGRAPHY_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Photography' },
  {
    type: 'paragraph',
    text: 'One roll a month. Colour in summer, black and white in winter. The habit matters more than the results.',
  },
  { type: 'heading2', text: '2026 — rolls shot' },
  { type: 'bulletedList', text: 'January — HP5, Edinburgh for a long weekend' },
  { type: 'bulletedList', text: 'February — HP5 pushed to 1600, indoor portraits' },
  { type: 'bulletedList', text: 'March — Portra 400, early spring light, local parks' },
  { type: 'bulletedList', text: 'April — Gold 200, back garden, testing the stock' },
  { type: 'bulletedList', text: "May — Portra 400, a friend's wedding, ceremony only" },
  { type: 'todo', text: 'Book a slot at the darkroom for August', checked: false },
  { type: 'todo', text: 'Order two more rolls of HP5 for autumn', checked: false },
];

// Someday maybe — ideas worth keeping but not yet worth scheduling.
const SOMEDAY_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Someday, maybe' },
  {
    type: 'paragraph',
    text: 'Things that seem worth doing but have no date yet. Reviewed once a quarter — anything that has been here for two years without moving to a project gets cut.',
  },
  { type: 'heading2', text: 'Places' },
  { type: 'bulletedList', text: 'A week in a cabin with no wifi — Highlands or Norwegian coast' },
  { type: 'bulletedList', text: 'Lisbon — everyone says the city has changed, worth checking' },
  { type: 'bulletedList', text: 'Edinburgh in winter, which is different from the long weekend' },
  { type: 'heading2', text: 'Learning' },
  { type: 'bulletedList', text: 'Japanese — at least hiragana and katakana before the trip' },
  { type: 'bulletedList', text: 'Darkroom printing, not just developing' },
  { type: 'bulletedList', text: 'Sourdough discard recipes — seems wasteful otherwise' },
  { type: 'heading2', text: 'Making' },
  { type: 'bulletedList', text: 'A proper photo book of the last two years of film, printed' },
  { type: 'bulletedList', text: 'Write up the flat renovation before the memory fades' },
];

// Recipes top-level section — what is in here and the rule of admission.
const RECIPES_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Recipes' },
  {
    type: 'paragraph',
    text: 'The ones that actually got made, not the ones bookmarked from the internet in 2019.',
  },
  { type: 'heading2', text: 'What is in here' },
  { type: 'bulletedList', text: 'Weeknight dinners — fast, reliable, under forty minutes' },
  { type: 'bulletedList', text: 'Baking — mostly bread, occasionally biscuits' },
  {
    type: 'callout',
    text: 'If it did not work the second time, it does not belong here.',
    props: '{"emoji":"\u{1F373}"}',
  },
];

// Weeknight dinners — the rules for what qualifies.
const WEEKNIGHT_DINNERS_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Weeknight dinners' },
  {
    type: 'paragraph',
    text: 'Everything here cooks in under forty minutes and has under ten ingredients. Enough for lunch the next day.',
  },
  { type: 'heading2', text: 'The rules' },
  { type: 'bulletedList', text: 'Nothing that needs more than two pans' },
  { type: 'bulletedList', text: 'Substitutions should be obvious from the recipe' },
  { type: 'bulletedList', text: 'If it needs a mixer or food processor it goes in Baking instead' },
];

// Miso noodle soup — a twenty-minute weeknight recipe.
const MISO_NOODLE_SOUP_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Miso noodle soup' },
  { type: 'paragraph', text: 'Twenty minutes start to finish. The broth carries everything.' },
  { type: 'heading2', text: 'Ingredients — 2 portions' },
  { type: 'bulletedList', text: '2 tbsp white miso paste' },
  { type: 'bulletedList', text: '1 litre vegetable stock' },
  { type: 'bulletedList', text: '200g soba noodles' },
  { type: 'bulletedList', text: '100g firm tofu, cubed' },
  { type: 'bulletedList', text: '2 spring onions, thinly sliced' },
  { type: 'bulletedList', text: '1 tsp sesame oil' },
  { type: 'heading2', text: 'Method' },
  {
    type: 'numberedList',
    text: 'Bring stock to a gentle simmer — do not boil once the miso goes in',
  },
  { type: 'numberedList', text: 'Add tofu, simmer 3 minutes' },
  { type: 'numberedList', text: 'Cook soba separately for 5 minutes, drain well' },
  { type: 'numberedList', text: 'Take stock off the heat, whisk in the miso' },
  { type: 'numberedList', text: 'Add noodles, top with sesame oil and spring onions' },
  {
    type: 'callout',
    text: 'Miso goes in off the heat. Boiling destroys the flavour.',
    props: '{"emoji":"\u{26A0}\u{FE0F}"}',
  },
];

// Sheet pan chicken — a one-tray oven dinner.
const SHEET_PAN_CHICKEN_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Sheet pan chicken' },
  { type: 'paragraph', text: 'One pan in the oven. Nothing to do after the first five minutes.' },
  { type: 'heading2', text: 'Ingredients — 2 portions' },
  { type: 'bulletedList', text: '4 chicken thighs, bone in, skin on' },
  { type: 'bulletedList', text: '2 courgettes, roughly chopped' },
  { type: 'bulletedList', text: '1 red pepper, roughly chopped' },
  { type: 'bulletedList', text: 'Olive oil, smoked paprika, dried oregano, salt' },
  { type: 'heading2', text: 'Method' },
  { type: 'numberedList', text: 'Oven to 200°C fan' },
  { type: 'numberedList', text: 'Toss vegetables with oil and seasoning, spread on the tray' },
  { type: 'numberedList', text: 'Rub chicken with paprika and oregano, place skin side up on top' },
  { type: 'numberedList', text: '45 minutes, no turning required' },
];

// Baking section — the starter is called Frank.
const BAKING_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Baking' },
  {
    type: 'paragraph',
    text: 'Bread mostly. The sourdough starter has been alive since March 2025 and is called Frank.',
  },
  { type: 'heading2', text: 'What is here' },
  { type: 'bulletedList', text: 'Sourdough log — every bake recorded with what changed' },
  { type: 'bulletedList', text: 'Recipes as they get tested and confirmed' },
  { type: 'todo', text: 'Try a focaccia with the sourdough discard', checked: false },
  { type: 'todo', text: 'Test the rye loaf again at 30% rye flour', checked: false },
];

// Sourdough log — Frank the starter's bake diary.
const SOURDOUGH_LOG_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Sourdough log' },
  {
    type: 'paragraph',
    text: 'Every loaf gets an entry: the hydration, what changed, how it went. Patterns only emerge if the data is there.',
  },
  { type: 'heading2', text: 'Recent bakes' },
  {
    type: 'bulletedList',
    text: '2026-07-28 — 75% hydration, 12h cold proof. Good oven spring. Ear slightly pale but crumb open.',
  },
  {
    type: 'bulletedList',
    text: '2026-07-14 — 80% hydration experiment. Sticky and dense. 75% is the ceiling for now.',
  },
  {
    type: 'bulletedList',
    text: '2026-06-30 — Back to 75% baseline after the high-hydration attempt. Best crumb in weeks.',
  },
  { type: 'heading2', text: 'Notes to self' },
  { type: 'todo', text: 'Score deeper on the next high-hydration bake', checked: false },
  { type: 'todo', text: 'Try lid off for the last 10 minutes for a darker crust', checked: true },
  {
    type: 'callout',
    text: 'Frank needs feeding every 5 days in the fridge. Last fed: 2026-08-12.',
    props: '{"emoji":"\u{1F35E}"}',
  },
];

// Travel top-level section — what is booked and what is still an idea.
const TRAVEL_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Travel' },
  {
    type: 'paragraph',
    text: 'One trip already booked — Japan in April 2027. One more needed before the year ends.',
  },
  { type: 'heading2', text: 'In progress' },
  { type: 'bulletedList', text: 'Japan 2027 — flights booked, itinerary in progress' },
  { type: 'heading2', text: 'Ideas for before the year ends' },
  { type: 'bulletedList', text: 'Porto in October — flights are cheap before the weather turns' },
  { type: 'bulletedList', text: 'A weekend somewhere by train, destination open' },
  { type: 'todo', text: 'Check Porto flight prices in early September', checked: false },
];

// Japan 2027 — the trip overview, what is booked, what is not.
const JAPAN_2027_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Japan 2027' },
  {
    type: 'paragraph',
    text: 'Two weeks in April. Tokyo for three nights, then south by Shinkansen — Kyoto, Hiroshima, back to Tokyo for the flight.',
  },
  { type: 'heading2', text: 'Booked' },
  { type: 'todo', text: 'Return flights to Tokyo, 5 April to 19 April', checked: true },
  { type: 'todo', text: '14-day JR Pass, ordered from the UK', checked: true },
  { type: 'heading2', text: 'Still to book' },
  { type: 'todo', text: 'Tokyo hotel — nights 1 to 3', checked: false },
  { type: 'todo', text: 'Kyoto accommodation — guesthouse preferred, not a chain', checked: false },
  { type: 'todo', text: 'Hiroshima day trip from Kyoto', checked: false },
  { type: 'heading3', text: 'Budget estimate' },
  {
    type: 'paragraph',
    text: 'Flights £700, JR Pass £450, accommodation £1,200, food and local transport £600. Total: £2,950.',
  },
];

// Kyoto shortlist — places worth visiting and the rule about going slowly.
const KYOTO_SHORTLIST_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Kyoto shortlist' },
  {
    type: 'paragraph',
    text: 'Five days is not enough for all of this. Pick six things and do them properly rather than rushing through twelve.',
  },
  { type: 'heading2', text: 'Temples and shrines' },
  {
    type: 'bulletedList',
    text: 'Fushimi Inari — go before 7am or after 6pm; the midday crowds are not the point',
  },
  { type: 'bulletedList', text: 'Ryoan-ji — the rock garden. Twenty minutes is enough.' },
  { type: 'bulletedList', text: 'Kinkaku-ji — expect a crowd. Worth it anyway.' },
  { type: 'heading2', text: 'Neighbourhoods' },
  {
    type: 'bulletedList',
    text: 'Gion in the early morning — the only time it feels like what it is',
  },
  { type: 'bulletedList', text: 'Nishiki Market for food and a wander' },
  { type: 'heading2', text: 'Practical' },
  { type: 'bulletedList', text: 'IC card covers all local transport' },
  {
    type: 'bulletedList',
    text: 'Most temples close around 5pm — do not leave them for late afternoon',
  },
  { type: 'quote', text: 'Slow down. You will regret trying to fit in eight temples in a day.' },
];

// Reading list top-level section — the one-book rule and what is currently on the go.
const READING_LIST_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Reading list' },
  {
    type: 'paragraph',
    text: 'One book at a time. The rule against starting a second before finishing the first is the only thing that makes reading stick.',
  },
  { type: 'heading2', text: 'Currently reading' },
  {
    type: 'bulletedList',
    text: 'A Philosophy of Software Design — Ousterhout, about halfway through',
  },
  { type: 'heading2', text: 'What is in here' },
  { type: 'bulletedList', text: 'Finished in 2026 — books read this year with brief notes' },
  {
    type: 'callout',
    text: 'One book at a time. Starting three and finishing none is not reading.',
    props: '{"emoji":"\u{1F4DA}"}',
  },
];

// Finished in 2026 — the log of books completed this year.
const FINISHED_2026_BLOCKS: SeedBlock[] = [
  { type: 'heading1', text: 'Finished in 2026' },
  { type: 'heading2', text: 'Q1' },
  {
    type: 'bulletedList',
    text: 'The Design of Everyday Things — Norman. Five stars. Read the second half twice.',
  },
  { type: 'bulletedList', text: 'Piranesi — Clarke. Strange and beautiful. Very fast read.' },
  { type: 'heading2', text: 'Q2' },
  { type: 'bulletedList', text: 'The Lean Startup — Ries. Abandoned after chapter 3.' },
  { type: 'heading2', text: 'Q3 so far' },
  { type: 'bulletedList', text: 'A Philosophy of Software Design — in progress' },
  {
    type: 'todo',
    text: 'Write up notes on the deep module principle once finished',
    checked: false,
  },
];

// A page tree that reads like a real person's workspace: six top-level entries (four pages plus two
// databases), four levels deep at the deepest, every page with an emoji icon and real content.
// The sidebar shows: Home, Recipes, Travel, Reading list (pages) + Work Projects, Book Tracker
// (databases). Home has three children: Journal, Projects, Someday maybe.
export const SEED_PAGES: SeedPage[] = [
  {
    title: 'Home',
    icon: '🏠',
    blocks: [
      { type: 'heading2', text: 'Start here' },
      {
        type: 'paragraph',
        text: 'The sidebar has six top-level sections. Three live here — Journal, Projects and Someday maybe — and three sit alongside: Recipes, Travel and Reading list. Work Projects and Book Tracker are databases at the root.',
      },
      { type: 'bulletedList', text: 'Journal — the weekly review and the yearly intentions' },
      { type: 'bulletedList', text: 'Projects — anything with a defined end' },
      {
        type: 'bulletedList',
        text: 'Someday maybe — things worth keeping but not yet worth scheduling',
      },
      {
        type: 'callout',
        text: 'Press the slash key on any empty line to change what a block is.',
        props: '{"emoji":"\u{2728}"}',
      },
    ],
    children: [
      {
        title: 'Journal',
        icon: '📓',
        blocks: JOURNAL_BLOCKS,
        children: [
          { title: '2026 Intentions', icon: '🌱', blocks: INTENTIONS_BLOCKS },
          {
            title: 'Weekly Review',
            icon: '🗓️',
            blocks: WEEKLY_REVIEW_BLOCKS,
            children: [
              { title: 'Week 32 - what worked', icon: '✅', blocks: WEEK_32_WORKED_BLOCKS },
              { title: 'Week 32 - what to drop', icon: '🧹', blocks: WEEK_32_DROP_BLOCKS },
            ],
          },
        ],
      },
      {
        title: 'Projects',
        icon: '🧭',
        blocks: PROJECTS_BLOCKS,
        children: [
          {
            title: 'Flat Renovation',
            icon: '🏡',
            blocks: FLAT_RENOVATION_BLOCKS,
            children: [
              { title: 'Lighting ideas', icon: '💡', blocks: LIGHTING_BLOCKS },
              { title: 'Budget notes', icon: '💰', blocks: BUDGET_NOTES_BLOCKS },
            ],
          },
          {
            title: 'Photography',
            icon: '📷',
            blocks: PHOTOGRAPHY_BLOCKS,
            children: [{ title: 'Film stock notes', icon: '🎞️', blocks: FILM_STOCK_BLOCKS }],
          },
        ],
      },
      { title: 'Someday, maybe', icon: '🛸', blocks: SOMEDAY_BLOCKS },
    ],
  },
  {
    title: 'Recipes',
    icon: '🍜',
    blocks: RECIPES_BLOCKS,
    children: [
      {
        title: 'Weeknight dinners',
        icon: '🥗',
        blocks: WEEKNIGHT_DINNERS_BLOCKS,
        children: [
          { title: 'Miso noodle soup', icon: '🍲', blocks: MISO_NOODLE_SOUP_BLOCKS },
          { title: 'Sheet pan chicken', icon: '🍗', blocks: SHEET_PAN_CHICKEN_BLOCKS },
        ],
      },
      {
        title: 'Baking',
        icon: '🍞',
        blocks: BAKING_BLOCKS,
        children: [{ title: 'Sourdough log', icon: '🥖', blocks: SOURDOUGH_LOG_BLOCKS }],
      },
    ],
  },
  {
    title: 'Travel',
    icon: '✈️',
    blocks: TRAVEL_BLOCKS,
    children: [
      {
        title: 'Japan 2027',
        icon: '🗾',
        blocks: JAPAN_2027_BLOCKS,
        children: [
          { title: 'Kyoto shortlist', icon: '🏯', blocks: KYOTO_SHORTLIST_BLOCKS },
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
    blocks: READING_LIST_BLOCKS,
    children: [{ title: 'Finished in 2026', icon: '📖', blocks: FINISHED_2026_BLOCKS }],
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
