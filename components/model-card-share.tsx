"use client";

import {
  buildBlueskyShareIntentUrl,
  buildLinkedInShareIntentUrl,
  buildXShareIntentUrl,
  canShareFileNatively,
} from "@hraness/design-kit/browser";
import {
  Button,
  CopyButton,
  LinkButton,
  SocialIcon,
  WrappingRow,
} from "@hraness/ui";
import { Copy01Icon, Download01Icon, Share08Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui";
import { useEffect, useMemo, useState } from "react";

import { captureAnalyticsEvent } from "@/lib/analytics";
import type { ModelCardPresentation } from "@/lib/model-card-presentation";
import {
  prepareModelCardImage,
  sharePreparedModelCardImage,
  type PreparedModelCardImage,
} from "@/lib/model-card-share";

function modelCardFilename(card: ModelCardPresentation): string {
  return `aicharts-${card.canonicalModelId.replaceAll("/", "-")}-${card.profileSlug}.png`;
}

export function ModelCardShare({
  card,
  canonicalUrl,
  imageUrl,
}: Readonly<{
  card: ModelCardPresentation;
  canonicalUrl: string;
  imageUrl: string;
}>) {
  const [prepared, setPrepared] = useState<PreparedModelCardImage | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState("");
  const filename = modelCardFilename(card);
  const preparedImage = prepared?.imageUrl === imageUrl ? prepared : null;
  const preparationFailed = failedImageUrl === imageUrl;
  const nativeShareAvailable = preparedImage !== null && canShareFileNatively(preparedImage.file);
  const shareText = `${card.displayTitle} coding-agent benchmark card`;
  const socialLinks = useMemo(() => ({
    bluesky: buildBlueskyShareIntentUrl({ text: shareText, url: canonicalUrl }),
    linkedin: buildLinkedInShareIntentUrl(canonicalUrl),
    x: buildXShareIntentUrl({ text: shareText, url: canonicalUrl }),
  }), [canonicalUrl, shareText]);

  function captureShare(
    shareMethod: "bluesky" | "copy_link" | "download_png" | "linkedin" | "native_share" | "x",
    shareOutcome: "cancelled" | "completed" | "downloaded" | "initiated",
  ) {
    captureAnalyticsEvent({
      name: "model card shared",
      properties: {
        model_id: card.canonicalModelId,
        profile_id: card.profileSlug,
        share_method: shareMethod,
        share_outcome: shareOutcome,
      },
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    const capabilityProbe = new File([], filename, { type: "image/png" });
    if (!canShareFileNatively(capabilityProbe)) return () => controller.abort();
    void prepareModelCardImage({ filename, imageUrl, signal: controller.signal })
      .then(nextPrepared => {
        if (controller.signal.aborted) return;
        setPrepared(nextPrepared);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setFailedImageUrl(imageUrl);
      });
    return () => controller.abort();
  }, [filename, imageUrl]);

  async function handleNativeShare() {
    if (preparedImage === null || sharing) return;
    setSharing(true);
    const result = await sharePreparedModelCardImage(preparedImage, filename);
    setSharing(false);
    if (result === "shared") {
      captureShare("native_share", "completed");
      setStatus("Image sent to the share sheet.");
    }
    if (result === "cancelled") {
      captureShare("native_share", "cancelled");
      setStatus("");
    }
    if (result === "downloaded") {
      captureShare("native_share", "downloaded");
      setStatus("Image sharing is unavailable here, so the PNG was downloaded.");
    }
  }

  return (
    <section aria-labelledby="model-card-share-title" className="model-card-share">
      <h2 id="model-card-share-title">Share card</h2>
      <WrappingRow className="model-card-share__primary">
        {nativeShareAvailable && (
          <Button
            isPending={sharing}
            leading={<Icon icon={Share08Icon} size={16} strokeWidth={1.7} />}
            onPress={() => { void handleNativeShare(); }}
            size="compact"
            variant="primary"
          >
            Share image
          </Button>
        )}
        <LinkButton
          download={filename}
          href={imageUrl}
          leading={<Icon icon={Download01Icon} size={16} strokeWidth={1.7} />}
          onPress={() => captureShare("download_png", "initiated")}
          size="compact"
          variant={nativeShareAvailable ? "secondary" : "primary"}
        >
          Download PNG
        </LinkButton>
        <CopyButton
          copiedLabel="Link copied"
          copyLabel="Copy link"
          leading={<Icon icon={Copy01Icon} size={16} strokeWidth={1.7} />}
          onCopySuccess={() => captureShare("copy_link", "completed")}
          size="compact"
          value={canonicalUrl}
          variant="quiet"
        />
      </WrappingRow>
      <WrappingRow aria-label="Post the model card link" as="nav" className="model-card-share__social">
        <LinkButton
          href={socialLinks.x}
          leading={<SocialIcon name="x" />}
          onPress={() => captureShare("x", "initiated")}
          rel="noopener noreferrer"
          size="compact"
          target="_blank"
          variant="quiet"
        >
          X
        </LinkButton>
        <LinkButton
          href={socialLinks.bluesky}
          leading={<SocialIcon name="bluesky" />}
          onPress={() => captureShare("bluesky", "initiated")}
          rel="noopener noreferrer"
          size="compact"
          target="_blank"
          variant="quiet"
        >
          Bluesky
        </LinkButton>
        <LinkButton
          href={socialLinks.linkedin}
          leading={<SocialIcon name="linkedin" />}
          onPress={() => captureShare("linkedin", "initiated")}
          rel="noopener noreferrer"
          size="compact"
          target="_blank"
          variant="quiet"
        >
          LinkedIn
        </LinkButton>
      </WrappingRow>
      {preparationFailed && (
        <p className="model-card-share__status" role="status">
          Native image sharing is unavailable, but you can still download the PNG or post the card link.
        </p>
      )}
      {status !== "" && <p className="model-card-share__status" role="status">{status}</p>}
    </section>
  );
}
