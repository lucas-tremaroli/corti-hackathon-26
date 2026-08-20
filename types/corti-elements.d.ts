import type { CortiDictation } from "@corti/dictation-web";
import type { CortiAmbient } from "@corti/ambient-web";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "corti-dictation": React.HTMLAttributes<HTMLElement> & {
        ref?: React.Ref<CortiDictation>;
      };
      "corti-ambient": React.HTMLAttributes<HTMLElement> & {
        ref?: React.Ref<CortiAmbient>;
        interactionId?: string;
      };
    }
  }
}
