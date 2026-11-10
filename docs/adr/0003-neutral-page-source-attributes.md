# The Page source uses neutral attribute names

The Page source names the Stable id `id` and gives bounds as `x`, `y`, `width`, `height`, with `clickable`, `checkable`, `editable` and `scrollable` flags. It does not copy Android names such as `resource-id` or `[x1,y1][x2,y2]` bounds, although optics already reads those. optics adds an `@id` locator rung instead, so the driver stays useful to clients other than optics.
