# Client rendering inputs

`mars-fork-land.json` contains only the constants, initial state and `group: land`
batch from `worlds/templates/mars-two.json`. The legacy Mars backdrop renders
these operations; importing the full enriched template would also download every
campus patch and description without using them.

The Mars fork test compares this input to the template. Refresh it when the
template's land, constants or initial state changes; keep unrelated campus and
meaning batches out of the client input.
