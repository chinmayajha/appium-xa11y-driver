# Bounds, pointer input and screenshots share Desktop coordinates

macOS reports bounds in points while its screenshots are in pixels, and GTK4 reports child bounds relative to the parent. Clients locate by image and text on the screenshot and then tap there, so a mismatch sends taps to the wrong place. The driver converts once: `Tree` makes every rect absolute in logical points, and `Screen` scales images to the same size. An element whose bounds cannot be made reliable has no bounds in the Page source.
