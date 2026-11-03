/* Keep the previous decoded frame on screen until the next clip is ready. */
(() => {
  class PetVideoPlayer {
    constructor(first, { onSwap, onError } = {}) {
      const second = first.cloneNode(false);
      second.id = 'pet-video-buffer';
      first.parentNode.insertBefore(second, first.nextSibling);
      this.videos = [first, second];
      this.front = first;
      this.source = '';
      this.generation = 0;
      this.cancelPending = null;
      this.onSwap = onSwap;
      this.onError = onError;
      for (const video of this.videos) {
        video.classList.add('pet-video-layer');
        video.style.opacity = '0';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
      }
    }

    async play(source, { loop = true, onEnded } = {}) {
      const generation = ++this.generation;
      if (this.cancelPending) this.cancelPending();
      if (this.source === source && this.front.readyState >= 2 && loop && this.front.loop) {
        this.front.style.opacity = '1';
        for (const video of this.videos) {
          if (video !== this.front) { video.pause(); video.style.opacity = '0'; video.onended = null; }
        }
        // A character snapshot calls stop() before choosing its idle clip.
        // Re-selecting the same role must resume this already decoded layer.
        const front = this.front;
        try { if (front.paused) await front.play(); }
        catch (error) {
          if (generation === this.generation && this.onError) this.onError(source, error);
          return false;
        }
        return generation === this.generation;
      }
      const back = this.videos.find((video) => video !== this.front);
      back.pause();
      back.onended = null;
      back.loop = loop;
      back.style.transition = 'none';
      back.style.opacity = '0';
      back.style.zIndex = '2';

      const ready = new Promise((resolve) => {
        let settled = false;
        let timer;
        const cleanup = () => {
          clearTimeout(timer);
          back.removeEventListener('loadeddata', loaded);
          back.removeEventListener('error', failed);
          if (this.cancelPending === cancelled) this.cancelPending = null;
        };
        const finish = (ok) => { if (!settled) { settled = true; cleanup(); resolve(ok); } };
        const loaded = () => finish(true);
        const failed = () => finish(false);
        const cancelled = () => finish(false);
        this.cancelPending = cancelled;
        back.addEventListener('loadeddata', loaded);
        back.addEventListener('error', failed);
        timer = setTimeout(failed, 10000);
        back.src = source;
        back.load();
      });
      if (!await ready || generation !== this.generation) {
        if (generation === this.generation && this.onError) this.onError(source);
        return false;
      }
      try { await back.play(); }
      catch (error) {
        if (generation === this.generation && this.onError) this.onError(source, error);
        return false;
      }
      // Wait for a decoded video frame rather than exposing an empty element.
      if (typeof back.requestVideoFrameCallback === 'function') {
        await Promise.race([
          new Promise((resolve) => back.requestVideoFrameCallback(resolve)),
          new Promise((resolve) => setTimeout(resolve, 150))
        ]);
      }
      if (generation !== this.generation) return false;
      const old = this.front;
      this.front = back;
      this.source = source;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const fadeMs = reducedMotion ? 0 : 110;
      back.style.transition = `opacity ${fadeMs}ms linear`;
      old.style.transition = `opacity ${fadeMs}ms linear`;
      old.style.zIndex = '1';
      back.style.opacity = '1';
      old.style.opacity = '0';
      back.onended = () => {
        if (generation === this.generation && this.front === back && typeof onEnded === 'function') onEnded();
      };
      if (this.onSwap) this.onSwap(back);
      setTimeout(() => {
        if (generation === this.generation && this.front !== old) { old.pause(); old.onended = null; }
      }, fadeMs + 30);
      return true;
    }

    stop() {
      ++this.generation;
      if (this.cancelPending) this.cancelPending();
      for (const video of this.videos) { video.pause(); video.onended = null; }
    }
  }
  window.PetVideoPlayer = PetVideoPlayer;
})();
