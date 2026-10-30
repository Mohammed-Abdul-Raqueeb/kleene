/**
 * The shapes a parsed pattern can take.
 *
 * Plain tagged objects rather than classes. The compiler is one switch over
 * the tag, and the nodes carry no behaviour -- only structure -- so classes
 * would spread that switch across a dozen files for nothing.
 */

/** Node type tags. */
export const Kind = {
  EMPTY: 'Empty',
  CHARSET: 'CharSet',
  CONCAT: 'Concat',
  ALTERNATE: 'Alternate',
  REPEAT: 'Repeat',
  GROUP: 'Group',
  ANCHOR: 'Anchor',
  BOUNDARY: 'Boundary',
};

/** What an anchor anchors to. */
export const AnchorKind = {
  START: 'start',
  END: 'end',
};

