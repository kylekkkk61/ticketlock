# Brand

| | |
| --- | --- |
| Name | TicketLock |
| Working tagline | Tickets you own, transfer and use once. |
| Mark | A ticket with a keyhole, on a rounded mint tile |

The tagline is the one used on the site and the social card. The team is free to replace it.

## Files

Everything is in [`brand/`](../brand), as SVG and PNG. Text in the SVGs is converted to outlines,
so no font needs to be installed.

| File | Use |
| --- | --- |
| `ticketlock-mark.svg` | The mark on its own |
| `ticketlock-mark-ink.svg` | Inverted mark, for placing on mint backgrounds |
| `ticketlock-wordmark.svg` / `.png` | Mark and name, for light backgrounds |
| `ticketlock-wordmark-light.svg` / `.png` | Mark and name, for dark backgrounds |
| `ticketlock-icon.svg`, `-512`, `-192`, `-180.png` | App icon |
| `ticketlock-og.svg` / `.png` | 1200×630 social preview card |

`brand/build.mjs` regenerates all of them.

## Colour

| Name | Hex | Use |
| --- | --- | --- |
| Ink | `#0E1512` | Text, dark surfaces |
| Mint | `#20E3A2` | The one accent: primary buttons, "available", the mark |
| Canvas | `#FFFFFF` | Light surfaces |
| Soft | `#F2F5F3` | Quiet panels |
| Body | `#5C6964` | Secondary text |

One accent colour only. Depth comes from the contrast between ink and canvas; there are no shadows
or gradients.

## Type

Inter throughout. Extra-bold (800) with tight spacing for headlines, upper case for the largest
display lines, regular (400) for text. Buttons are fully rounded pills.

## The documentation diagrams

The diagrams in [`docs/diagrams/`](diagrams) are deliberately black and white so they sit well on
any slide background. See that folder's README to edit and rebuild them.
