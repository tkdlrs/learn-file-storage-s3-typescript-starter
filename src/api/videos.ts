import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest, S3File } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError, type UserNotAuthenticatedError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { getAssetDiskPath, getAssetPath } from "./assets";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  //
  const MAX_UPLOAD_SIZE = 1 << 30;
  //
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invlaid video ID");
  }
  //
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  //
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError('Could not find video');
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError('Not authorized to updated this video');
  }
  //
  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError('Vidoe file missing');
  }
  //
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError('Video file exceeds the maximum allowed size of 10MB');
  }
  //
  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for video");
  }
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Invalid file type. Only MP4 allowed.")
  }
  //
  const assetPath = getAssetPath(mediaType);
  const assetDiskPath = getAssetDiskPath(cfg, assetPath);
  await Bun.write(assetDiskPath, file);
  //
  const tempFile = await Bun.file(assetDiskPath);
  //
  const s3file: S3File = cfg.s3Client.file(assetPath);
  s3file.write(tempFile, {
    type: mediaType
  });
  //
  tempFile.delete();
  //
  const urlPath = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${assetPath}`;
  video.videoURL = urlPath;
  updateVideo(cfg.db, video);
  //
  return respondWithJSON(200, video);
}
