# Reference Inventory

The reference repositories are reviewed at pinned commits. A later reference change does not enter this project until its behavior is reviewed and the pinned revision is updated intentionally.

| Repository | Pinned commit | Role |
| --- | --- | --- |
| `growth_at_console` | `d446d04fdf654bdbba253ae9615d37581523c99c` | Conversation, qualification, deal, CRM, competitor, GEO, and analytics tools |
| `spy` | `44e5d95e1df903f22fa401f02eb7c8bd58d6838e` | Competitive footprint detection and routing |

## Classifications

Each relevant source area receives one classification:

- `shared`: reusable platform behavior
- `framework`: reusable framework domain behavior
- `source connector`: external input integration
- `destination connector`: external write or notification integration
- `configuration`: company or vendor assumptions that must become data
- `example`: sanitized example only
- `excluded`: data, generated output, obsolete behavior, or unsafe material

## Inventories

- [Growth at Console](./growth-at-console.md)
- [Spy](./spy.md)
