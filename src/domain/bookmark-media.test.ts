import { describe, expect, it } from "vitest";

import {
  emptyBookmarkMedia,
  isBookmarkMedia,
  mergeBookmarkMedia,
  normalizeStableImageUrl,
} from "./bookmark-media";

describe("bookmark media", () => {
  it("allows only anonymous HTTPS URLs from the stable X image CDN", () => {
    expect(
      normalizeStableImageUrl(
        "https://pbs.twimg.com/media/example?format=jpg&name=large#fragment",
      ),
    ).toBe("https://pbs.twimg.com/media/example?format=jpg&name=large");
    expect(normalizeStableImageUrl("blob:https://x.com/temporary")).toBeNull();
    expect(normalizeStableImageUrl("data:image/png;base64,unsafe")).toBeNull();
    expect(normalizeStableImageUrl("https://video.twimg.com/file.mp4")).toBeNull();
    expect(
      normalizeStableImageUrl("https://user:secret@pbs.twimg.com/media/a"),
    ).toBeNull();
    expect(normalizeStableImageUrl("http://pbs.twimg.com/media/a")).toBeNull();
  });

  it("validates canonical video post references and rejects duplicate media", () => {
    const postUrl = "https://x.com/person/status/123";
    expect(
      isBookmarkMedia(
        {
          images: ["https://pbs.twimg.com/media/a"],
          videos: [
            {
              thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/123/thumb.jpg",
              postUrl,
            },
          ],
        },
        postUrl,
      ),
    ).toBe(true);
    expect(
      isBookmarkMedia(
        {
          images: [
            "https://pbs.twimg.com/media/a?format=jpg&name=small",
            "https://pbs.twimg.com/media/a?format=jpg&name=large",
          ],
          videos: [],
        },
        postUrl,
      ),
    ).toBe(false);
    expect(
      isBookmarkMedia(
        {
          images: [],
          videos: [{ thumbnailUrl: null, postUrl: "https://x.com/person/status/999" }],
        },
        postUrl,
      ),
    ).toBe(false);
  });

  it("merges newly observed media without changing established order", () => {
    const postUrl = "https://x.com/person/status/123";
    expect(
      mergeBookmarkMedia(
        {
          images: ["https://pbs.twimg.com/media/a"],
          videos: [{ thumbnailUrl: null, postUrl }],
        },
        {
          images: [
            "https://pbs.twimg.com/media/a?format=jpg&name=small",
            "https://pbs.twimg.com/media/b",
          ],
          videos: [
            {
              thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/123/thumb.jpg",
              postUrl,
            },
          ],
        },
      ),
    ).toEqual({
      images: ["https://pbs.twimg.com/media/a", "https://pbs.twimg.com/media/b"],
      videos: [
        {
          thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/123/thumb.jpg",
          postUrl,
        },
      ],
    });
    expect(emptyBookmarkMedia()).toEqual({ images: [], videos: [] });
  });

  it("rejects a redundant thumbnail-less video when a stable poster exists", () => {
    const postUrl = "https://x.com/person/status/123";
    expect(
      isBookmarkMedia(
        {
          images: [],
          videos: [
            { thumbnailUrl: null, postUrl },
            {
              thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/123/thumb.jpg",
              postUrl,
            },
          ],
        },
        postUrl,
      ),
    ).toBe(false);
  });
});
