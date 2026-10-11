/**
 * The component set both kits must export, and the props each must accept.
 *
 * ADR-2 buys a desktop app that feels like one by paying for the view layer
 * twice. The bill only stays at "twice the pixels" if the two kits stay
 * interchangeable — the moment `Button` takes `onPress` on one and `onClick`
 * on the other, every plugin author pays, forever, in both packages.
 *
 * So the component set is **data**, checked in CI, rather than a convention.
 * A plugin author writing both view packages should be transcribing, not
 * redesigning (docs/08 §6).
 *
 * Adding a component here is a deliberate act: it commits someone to writing
 * it twice.
 */

export interface PropSpec {
  name: string
  /** Absent means the component must work without it. */
  required?: boolean
  /**
   * Why it exists. Read when someone is deciding whether their new component
   * really needs a seventh prop.
   */
  note?: string
}

export interface ComponentSpec {
  name: string
  purpose: string
  props: PropSpec[]
}

/**
 * Props every component takes, so a caller never has to ask which ones do.
 *
 * `accessibilityLabel` is here rather than per-component because docs/08 §8
 * makes an accessible name mandatory on every interactive element, and a
 * per-component decision is one someone will get wrong.
 */
const UNIVERSAL: PropSpec[] = [
  { name: 'testID', note: 'One name for both platforms; the shells map it to their own.' },
  {
    name: 'accessibilityLabel',
    note: 'Written once here, mapped to aria-label or accessibilityLabel by the kit.',
  },
]

export const COMPONENT_CONTRACT: ComponentSpec[] = [
  {
    name: 'Button',
    purpose: 'The primary action control.',
    props: [
      { name: 'children', required: true },
      { name: 'onPress', required: true, note: 'Not onClick: one name, and a tap is not a click.' },
      { name: 'variant', note: 'primary | secondary | ghost | danger' },
      { name: 'disabled' },
      { name: 'loading', note: 'Shows progress *and* disables; two props would drift apart.' },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'IconButton',
    purpose: 'A control whose whole surface is one icon. Transport, overflow, close.',
    props: [
      { name: 'icon', required: true },
      { name: 'onPress', required: true },
      {
        name: 'accessibilityLabel',
        required: true,
        note: 'Required here, unlike elsewhere: an icon has no text to fall back on.',
      },
      { name: 'variant' },
      { name: 'disabled' },
      { name: 'size' },
      { name: 'testID' },
    ],
  },
  {
    name: 'TrackRow',
    purpose: 'One track in a list. The most-rendered component in the app.',
    props: [
      { name: 'track', required: true },
      { name: 'onPress' },
      { name: 'onMore', note: 'Overflow. Desktop also binds right-click; mobile long-press.' },
      {
        name: 'onToggleLoved',
        note: 'Toggle loved/favorite. Absent where the catalogue has no favorites.',
      },
      {
        name: 'onDownload',
        note: 'Queue for download. Absent where no downloads service is loaded.',
      },
      { name: 'active', note: 'This is the playing track, which is not the same as selected.' },
      { name: 'showArtwork' },
      { name: 'showAlbum' },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'Slider',
    purpose: 'Scrubber and volume.',
    props: [
      { name: 'value', required: true },
      { name: 'max', required: true },
      { name: 'onChange', note: 'While dragging.' },
      {
        name: 'onCommit',
        note: 'On release. Seeking on every frame of a drag is what makes a scrubber unusable.',
      },
      { name: 'disabled' },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'Sheet',
    purpose:
      'A modal surface. A bottom sheet on mobile, a dialog on desktop — one component ' +
      'because the *decision* to interrupt is the same, and only the shape differs.',
    props: [
      { name: 'open', required: true },
      { name: 'onClose', required: true },
      { name: 'title' },
      { name: 'children' },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'ContextMenu',
    purpose:
      'A right-click / long-press menu. A popover at the pointer on desktop, a bottom sheet ' +
      'on mobile; both replace their contents for a submenu.',
    props: [
      { name: 'open', required: true },
      { name: 'onClose', required: true },
      { name: 'items', required: true, note: 'Menu rows, built once by @BBeBee/ui-menus.' },
      { name: 'x', note: 'Pointer anchor. Desktop clamps it on screen; mobile ignores it.' },
      { name: 'y' },
      { name: 'title', note: 'The entity name; the sheet has no other context.' },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'List',
    purpose: 'A virtualised list. FlashList on mobile, react-virtual on desktop.',
    props: [
      { name: 'items', required: true },
      { name: 'renderItem', required: true },
      { name: 'keyExtractor', required: true, note: 'A 100k-track library needs stable keys.' },
      {
        name: 'estimatedItemSize',
        note: 'The desktop virtualiser windows by arithmetic and needs it; FlashList measures.',
      },
      { name: 'onEndReached' },
      { name: 'empty', note: 'What to show instead of nothing.' },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'EmptyState',
    purpose: 'What a screen shows before it has anything. Never a blank pane.',
    props: [
      { name: 'title', required: true },
      { name: 'description' },
      { name: 'action' },
      { name: 'icon' },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'Toast',
    purpose: 'Transient, non-blocking feedback.',
    props: [
      { name: 'message', required: true },
      { name: 'tone', note: 'info | ok | warn | error' },
      { name: 'action' },
      { name: 'onDismiss' },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'TextField',
    purpose:
      'Text entry. Controlled on both platforms, because an uncontrolled input on one ' +
      'of them diverges the moment anything resets the field.',
    props: [
      { name: 'value' },
      { name: 'onChange' },
      { name: 'placeholder' },
      {
        name: 'multiline',
        note: 'A pasted source document is hundreds of lines; a rule is one.',
      },
      { name: 'rows', note: 'Rows when multiline. Ignored otherwise.' },
      { name: 'secure', note: 'Hides the value. A password field, not a styling choice.' },
      { name: 'disabled' },
      { name: 'error', note: 'Rendered beneath, not a hover title: touch has no hover.' },
      {
        name: 'autoCorrect',
        note: 'Off by default. A rule silently autocorrected fails for a reason nothing explains.',
      },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'Text',
    purpose: 'Typography. The only place a font size is chosen.',
    props: [
      { name: 'children' },
      { name: 'variant', note: 'Names a scale entry; a raw size is never passed.' },
      { name: 'tone' },
      { name: 'numberOfLines' },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'Artwork',
    purpose: 'Album art. Renders the blurhash first, then the image (docs/08 §4).',
    props: [
      { name: 'artwork' },
      { name: 'size', required: true },
      { name: 'radius' },
      {
        name: 'seed',
        note: 'The entity URN. With no image, a deterministic identicon is generated from it.',
      },
      ...UNIVERSAL,
    ],
  },
  {
    name: 'JsonTree',
    purpose:
      'A parsed JSON value as a collapsible tree. For reading a response, not editing it — ' +
      'unparseable text is the caller\'s problem and stays text.',
    props: [
      { name: 'value', required: true, note: 'The already-parsed value, not JSON text.' },
      {
        name: 'defaultExpandedDepth',
        note: 'How many nesting levels start open. Default 2 — the shape without the noise.',
      },
      ...UNIVERSAL,
    ],
  },
]

export const COMPONENT_NAMES = COMPONENT_CONTRACT.map((c) => c.name)
