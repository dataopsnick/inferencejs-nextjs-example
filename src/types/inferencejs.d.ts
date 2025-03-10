// src/types/inferencejs.d.ts
declare module 'inferencejs' {
    export class InferenceEngine {
      constructor();
      
      /**
       * Starts a worker for inference
       * @param modelType The type of model to use
       * @param numThreads Number of threads to use
       * @param apiKey The API key for Roboflow
       * @returns A promise that resolves to the worker ID
       */
      startWorker(modelType: string, numThreads: number, apiKey: string): Promise<string>;
      
      /**
       * Runs inference on an image
       * @param workerId The worker ID
       * @param image The image to run inference on
       * @returns A promise that resolves to the predictions
       */
      infer(workerId: string, image: CVImage): Promise<Prediction[]>;
    }
  
    export class CVImage {
      constructor(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | string);
    }
  
    export interface Prediction {
      bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      class: string;
      color: string;
      confidence: number;
    }
  }