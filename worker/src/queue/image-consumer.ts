import type { Bindings } from '../bindings.js';
import { ImageGenerator } from '../services/image-generator.js';
import { MediaService } from '../services/media-service.js';
import type { ImageGenerationRequest } from 'shared';

export interface ImageJobMessage {
  jobId: string;
  userId: string;
  request: ImageGenerationRequest;
}

export async function handleImageQueue(
  batch: MessageBatch<ImageJobMessage>,
  env: Bindings,
): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body;
    const db = env.DB;
    const r2 = env.R2_BUCKET;

    // Update job status to processing
    await db.prepare(
      "UPDATE image_generation_jobs SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind('processing', job.jobId).run();

    try {
      const imageGenerator = new ImageGenerator(env.AI_TEXT_API_KEY);
      const images = await imageGenerator.generate(job.request);

      // Store first image in R2 via MediaService
      const mediaService = new MediaService(db, r2);
      const mediaItem = await mediaService.storeGenerated(images[0], job.userId);

      // Update job as completed with result media id
      await db.prepare(
        "UPDATE image_generation_jobs SET status = ?, result_media_id = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind('completed', mediaItem.id, job.jobId).run();

      message.ack();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';

      await db.prepare(
        "UPDATE image_generation_jobs SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind('failed', errorMsg, job.jobId).run();

      message.ack();
    }
  }
}
