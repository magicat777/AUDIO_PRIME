<script lang="ts">
  import hiresLogo from '../../../assets/hires-audio-logo.png';

  export let sampleRate: number = 0;
  export let bitDepth: number = 0;

  $: isHiRes = sampleRate > 44100;
  $: rateLabel = sampleRate >= 1000 ? `${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)}kHz` : `${sampleRate}Hz`;
  $: depthLabel = bitDepth > 0 ? `${bitDepth}bit` : '';
</script>

{#if isHiRes}
  <div class="hires-badge" title="{depthLabel} / {rateLabel}">
    <img src={hiresLogo} alt="Hi-Res Audio" class="hires-logo" />
    <span class="hires-spec">{depthLabel} / {rateLabel}</span>
  </div>
{/if}

<style>
  .hires-badge {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }

  .hires-logo {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }

  .hires-spec {
    font-size: 0.6rem;
    font-family: var(--font-mono, monospace);
    color: #d4a843;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
</style>
