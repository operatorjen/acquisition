const DEFAULT_ACCEPT_THRESHOLD = 0.6
const DEFAULT_DEFER_THRESHOLD = 0.4
const DEFAULT_MAX_TEXT_LENGTH = 320
const DEFAULT_MIN_TEXT_LENGTH = 4
const DEFAULT_TRACK_BY_PAIR = true
const NEUTRAL_LEVEL = 0.5
const NEUTRAL_STANCE_BAND = 'neutral'
const BASE_SCORE = 0.4
const LENGTH_IDEAL_FACTOR = 5
const LENGTH_LONG_FACTOR = 2
const LENGTH_BONUS = 0.1
const LENGTH_PENALTY = 0.1
const SOURCE_USER_BONUS = 0.05
const SOURCE_SYSTEM_PENALTY = 0.05
const TRUST_HIGH_THRESHOLD = 0.7
const TRUST_LOW_THRESHOLD = 0.3
const TRUST_HIGH_BONUS = 0.15
const TRUST_LOW_PENALTY = 0.15
const COMFORT_HIGH_THRESHOLD = 0.7
const COMFORT_LOW_THRESHOLD = 0.3
const COMFORT_HIGH_BONUS = 0.1
const COMFORT_LOW_PENALTY = 0.1
const SUPPORTIVE_BAND_BONUS = 0.05
const DEFENSIVE_BAND_PENALTY = 0.05
const NOVELTY_NEW_BONUS = 0.1
const NOVELTY_REPEAT_PENALTY = 0.02
const HIGH_ENGAGEMENT_BONUS = 0.05
const LOW_SIGNAL_PENALTY = 0.05
const MIN_SCORE = 0
const MAX_SCORE = 1

export class Acquisition {
  constructor(merger, relational = null, options = {}) {
    this.merger = merger
    this.relational = relational
    this.cfg = {
      acceptThreshold: options.acceptThreshold ?? DEFAULT_ACCEPT_THRESHOLD,
      deferThreshold: options.deferThreshold ?? DEFAULT_DEFER_THRESHOLD,
      maxTextLength: options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH,
      minTextLength: options.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH,
      trackByPair: options.trackByPair ?? DEFAULT_TRACK_BY_PAIR
    }
    this.stats = { accepted: 0, rejected: 0, deferred: 0 }
    this.pairMemory = new Map()
  }

  async consider({
    text,
    speakerId = null,
    targetId = null,
    direction = 'incoming',
    sourceType = 'internal',
    channels = []
  }) {
    const cleaned = (text || '').trim()
    if (!cleaned) {
      return {
        decision: 'reject',
        score: 0,
        stanceBand: NEUTRAL_STANCE_BAND,
        mergerResult: null,
        snapshot: null
      }
    }
    const rS = this._getRelationalSnapshot(speakerId, targetId)
    const nI = this._updateNovelty(speakerId, targetId, cleaned)
    const score = this._scoreCandidate({
      text: cleaned,
      sourceType,
      channels,
      relationalSnapshot: rS,
      noveltyInfo: nI
    })
    const decision = this._decisionFromScore(score)
    this._updateStats(decision)
    let stanceBand = rS?.stanceBand || NEUTRAL_STANCE_BAND, mS = null
    if (decision === 'accept' && this.merger && typeof this.merger.observeUtterance === 'function') {
      mS = await this.merger.observeUtterance({
        text: cleaned,
        speakerId,
        targetId,
        direction,
        context: {
          sourceType,
          channels,
          trustLevel: rS?.trust ?? NEUTRAL_LEVEL,
          comfortLevel: rS?.comfort ?? NEUTRAL_LEVEL,
          acquisitionScore: score
        }
      })
      const uS = this._getRelationalSnapshot(speakerId, targetId)
      stanceBand = uS?.stanceBand || stanceBand
    }
    return { decision, score, stanceBand, mergerResult: mS, snapshot: rS }
  }

  getStats() { return { ...this.stats } }

  getPairStats(speakerId, targetId) {
    if (!this.cfg.trackByPair) return null
    const key = this._pairKey(speakerId, targetId), entry = this.pairMemory.get(key)
    if (!entry) return { seenCount: 0, uniqueTexts: 0 }
    return { seenCount: entry.count, uniqueTexts: entry.seenTexts.size }
  }

  _pairKey(speakerId, targetId) { return `${speakerId || '∅'}->${targetId || '∅'}` }

  _getRelationalSnapshot(speakerId, targetId) {
    if (!this.relational || !speakerId || !targetId) return null
    try {
      const i = this.relational.getInteraction(speakerId, targetId)
      const state = i?.state || {}
      const stance = state.stance || 'cautious'
      const stanceBand = this._mapRelationalStanceToBand(stance)
      return {
        trust: state.trust ?? NEUTRAL_LEVEL,
        comfort: state.comfort ?? NEUTRAL_LEVEL,
        alignment: state.alignment ?? NEUTRAL_LEVEL,
        energy: state.energy ?? NEUTRAL_LEVEL,
        stance,
        stanceBand
      }
    } catch { return null }
  }

  _mapRelationalStanceToBand(relationalStance) {
    const s = (relationalStance || '').toLowerCase()
    if (s === 'defensive') return 'defensive'
    if (s === 'cautious') return 'neutral'
    if (s === 'collaborative') return 'supportive'
    if (s === 'intimate') return 'supportive'
    return 'neutral'
  }

  _updateNovelty(speakerId, targetId, text) {
    if (!this.cfg.trackByPair || !speakerId || !targetId) return { isNewForPair: false, totalForPair: 0 }
    const key = this._pairKey(speakerId, targetId)
    let entry = this.pairMemory.get(key)
    if (!entry) {
      entry = { seenTexts: new Set(), count: 0 }
      this.pairMemory.set(key, entry)
    }
    entry.count += 1
    const normalized = text.toLowerCase()
    const isNew = !entry.seenTexts.has(normalized)
    if (isNew) entry.seenTexts.add(normalized)
    return { isNewForPair: isNew, totalForPair: entry.count }
  }

  _scoreCandidate({ text, sourceType, channels, relationalSnapshot, noveltyInfo }) {
    let score = BASE_SCORE
    const words = text.split(/\s+/).filter(Boolean)
    const length = words.length
    const iM = this.cfg.maxTextLength / LENGTH_IDEAL_FACTOR
    const lW = this.cfg.maxTextLength / LENGTH_LONG_FACTOR
    if (length >= this.cfg.minTextLength && length <= iM) {
      score += LENGTH_BONUS
    } else if (length > lW) {
      score -= LENGTH_PENALTY
    } else if (length < this.cfg.minTextLength) {
      score -= LENGTH_PENALTY
    }
    if (sourceType === 'user') score += SOURCE_USER_BONUS
    if (sourceType === 'system') score -= SOURCE_SYSTEM_PENALTY
    if (relationalSnapshot) {
      const { trust, comfort, stanceBand } = relationalSnapshot
      if (trust > TRUST_HIGH_THRESHOLD) score += TRUST_HIGH_BONUS
      else if (trust < TRUST_LOW_THRESHOLD) score -= TRUST_LOW_PENALTY
      if (comfort > COMFORT_HIGH_THRESHOLD) score += COMFORT_HIGH_BONUS
      else if (comfort < COMFORT_LOW_THRESHOLD) score -= COMFORT_LOW_PENALTY
      if (stanceBand === 'supportive') score += SUPPORTIVE_BAND_BONUS
      if (stanceBand === 'defensive') score -= DEFENSIVE_BAND_PENALTY
    }
    score = (noveltyInfo?.isNewForPair) ? score + NOVELTY_NEW_BONUS : score - NOVELTY_REPEAT_PENALTY
    if (Array.isArray(channels) && channels.length) {
      if (channels.includes('high-engagement')) score += HIGH_ENGAGEMENT_BONUS
      if (channels.includes('low-signal')) score -= LOW_SIGNAL_PENALTY
    }
    if (score < MIN_SCORE) score = MIN_SCORE
    if (score > MAX_SCORE) score = MAX_SCORE
    return score
  }

  _decisionFromScore(score) {
    if (score >= this.cfg.acceptThreshold) return 'accept'
    if (score >= this.cfg.deferThreshold) return 'defer'
    return 'reject'
  }

  _updateStats(decision) {
    if (decision === 'accept') this.stats.accepted += 1
    else if (decision === 'reject') this.stats.rejected += 1
    else if (decision === 'defer') this.stats.deferred += 1
  }
}

export function createAcquisitionModule(merger, relational = null, options = {}) {
  const acquisition = new Acquisition(merger, relational, options)
  return { acquisition }
}