<script lang="ts">
</script>

<div class="capsule" aria-hidden="true">
  <span class="dot dot-idle"></span>
  <div class="bars">
    <span></span><span></span><span></span><span></span>
  </div>
  <div class="thinking">
    <span></span><span></span><span></span>
  </div>
  <div class="glow"></div>
</div>

<style>
  .capsule {
    position: relative;
    width: 220px;
    height: 64px;
    border-radius: 999px;
    background: rgba(19, 22, 27, 0.85);
    border: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .glow {
    position: absolute;
    inset: -40px;
    border-radius: 999px;
    background: radial-gradient(closest-side, rgba(92, 191, 190, 0.35), transparent 70%);
    filter: blur(28px);
    z-index: -1;
    pointer-events: none;
  }

  /* idle dot — visible 0-40% of the 10s cycle */
  .dot-idle {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-accent);
    box-shadow: 0 0 16px rgba(92, 191, 190, 0.7);
    opacity: 1;
    animation: idle-cycle 10s infinite ease-in-out;
    position: absolute;
  }
  @keyframes idle-cycle {
    0%,
    35% {
      opacity: 1;
      transform: scale(1);
    }
    8% {
      transform: scale(1.18);
    }
    16% {
      transform: scale(1);
    }
    40%,
    100% {
      opacity: 0;
      transform: scale(0.8);
    }
  }

  /* bars — visible 40-80% */
  .bars {
    display: flex;
    gap: 6px;
    align-items: center;
    opacity: 0;
    animation: bars-cycle 10s infinite;
    position: absolute;
  }
  .bars span {
    display: block;
    width: 5px;
    height: 18px;
    background: var(--color-accent);
    border-radius: 3px;
    animation: bar-bounce 0.8s infinite ease-in-out;
  }
  .bars span:nth-child(2) {
    animation-delay: 0.15s;
  }
  .bars span:nth-child(3) {
    animation-delay: 0.3s;
  }
  .bars span:nth-child(4) {
    animation-delay: 0.45s;
  }
  @keyframes bars-cycle {
    0%,
    38% {
      opacity: 0;
    }
    42%,
    78% {
      opacity: 1;
    }
    80%,
    100% {
      opacity: 0;
    }
  }
  @keyframes bar-bounce {
    0%,
    100% {
      transform: scaleY(0.4);
    }
    50% {
      transform: scaleY(1);
    }
  }

  /* thinking dots — visible 80-100% */
  .thinking {
    display: flex;
    gap: 8px;
    opacity: 0;
    animation: thinking-cycle 10s infinite;
    position: absolute;
  }
  .thinking span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent);
    animation: thinking-fade 1.2s infinite ease-in-out;
  }
  .thinking span:nth-child(2) {
    animation-delay: 0.2s;
  }
  .thinking span:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes thinking-cycle {
    0%,
    78% {
      opacity: 0;
    }
    82%,
    98% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes thinking-fade {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot-idle,
    .bars,
    .thinking,
    .bars span,
    .thinking span {
      animation: none;
    }
    .dot-idle {
      opacity: 1;
    }
    .bars,
    .thinking {
      opacity: 0;
    }
  }
</style>
