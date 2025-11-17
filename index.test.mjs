import { Acquisition } from './index.mjs'

function banner(title) {
  console.log(`\n\n${title}`)
  console.log('='.repeat(60))
}

function section(title) { console.log(`\n— ${title} —`) }

function assert(condition, message) { if (!condition) throw new Error(message || 'Assertion failed') }

class FakeMerger {
  constructor() {
    this.calls = []
  }

  async observeUtterance(payload) {
    this.calls.push(payload)
    return {
      stance: 'supportive',
      template: 'My {noun} is {adjective}',
      lexicon: {
        nouns: ['pattern'],
        verbs: ['notice'],
        adjectives: ['supportive'],
        adverbs: [],
        conjunctions: []
      }
    }
  }
}

class FakeRelational {
  constructor() {
    this.interactions = new Map()
  }

  _key(fromId, toId) { return `${fromId || '∅'}->${toId || '∅'}` }

  ensureInteraction(fromId, toId) {
    const key = this._key(fromId, toId)
    if (!this.interactions.has(key)) {
      this.interactions.set(key, {
        fromId,
        toId,
        state: {
          stance: 'cautious',
          trust: 0.5,
          comfort: 0.5,
          alignment: 0.5,
          energy: 0.5
        }
      })
    }
    return this.interactions.get(key)
  }

  setInteractionState(fromId, toId, statePatch) {
    const i = this.ensureInteraction(fromId, toId)
    Object.assign(i.state, statePatch)
    return i
  }

  getInteraction(fromId, toId) { return this.ensureInteraction(fromId, toId) }

  updateInteractionState(fromId, toId, delta) {
    const i = this.ensureInteraction(fromId, toId)
    const s = i.state
    s.trust += delta.trust || 0
    s.comfort += delta.comfort || 0
    s.alignment += delta.alignment || 0
    s.energy += delta.energy || 0
    return i
  }
}

async function basicAcquisitionDecisionTest() {
  banner('ACQUISITION BASIC DECISION TEST')
  const merger = new FakeMerger()
  const relational = new FakeRelational()
  const acquisition = new Acquisition(merger, relational, {
    acceptThreshold: 0.6,
    deferThreshold: 0.4
  })
  const speakerId = 'Alpha'
  const targetId = 'Beta'
  relational.setInteractionState(speakerId, targetId, {
    stance: 'defensive',
    trust: 0.2,
    comfort: 0.2
  })

  section('Low-trust / defensive case (expected: reject)')
  const lowTrustResult = await acquisition.consider({
    text: 'System boilerplate that we do not want to learn from',
    speakerId,
    targetId,
    direction: 'incoming',
    sourceType: 'system',
    channels: ['low-signal']
  })
  console.log('Decision (low trust):', lowTrustResult)
  assert(lowTrustResult.decision === 'reject', `Expected 'reject' but got "${lowTrustResult.decision}"`)
  assert(merger.calls.length === 0, 'Merger.observeUtterance should not be called for rejected candidates')
  relational.setInteractionState(speakerId, targetId, {
    stance: 'collaborative',
    trust: 0.8,
    comfort: 0.8
  })

  section('High-trust / collaborative case (expected: accept)')
  const highTrustResult = await acquisition.consider({
    text: 'I notice this pattern feels supportive and spacious',
    speakerId,
    targetId,
    direction: 'outgoing',
    sourceType: 'user',
    channels: ['high-engagement']
  })
  console.log('Decision (high trust):', highTrustResult)
  assert(highTrustResult.decision === 'accept', `Expected 'accept' but got "${highTrustResult.decision}"`)
  assert(merger.calls.length === 1, 'Merger.observeUtterance should be called exactly once for accepted candidate')
  const call = merger.calls[0]
  assert(call.text.includes('supportive and spacious'), 'Merger call should receive the original text')
  assert(call.speakerId === speakerId, 'Merger call should preserve speakerId')
  assert(call.targetId === targetId, 'Merger call should preserve targetId')

  section('Stats and Snapshot Check')
  const stats = acquisition.getStats()
  console.log('Acquisition stats:', stats)
  assert(stats.accepted === 1, 'Expected exactly 1 accepted candidate')
  assert(stats.rejected === 1, 'Expected exactly 1 rejected candidate')
  assert(stats.deferred === 0, 'Expected 0 deferred candidates')
  const snapshot = highTrustResult.snapshot
  console.log('Relational snapshot (high trust):', snapshot)
  assert(snapshot && snapshot.stanceBand === 'supportive', 'Snapshot stanceBand should be supportive for collaborative interaction')
  console.log('✅ Acquisition basic decision flow behaves as expected')
}

async function pairNoveltyAndStatsTest() {
  banner('ACQUISITION PAIR NOVELTY AND STATS TEST')
  const acquisition = new Acquisition(null, null, {
    acceptThreshold: 0.6,
    deferThreshold: 0.4
  })
  const speakerId = 'Gamma'
  const targetId = 'Delta'
  const text = 'This conversation feels gently attentive and aligned'

  section('First observation for pair (expected: higher score, potential accept/defer)')
  const firstResult = await acquisition.consider({
    text,
    speakerId,
    targetId,
    direction: 'incoming',
    sourceType: 'user',
    channels: ['high-engagement']
  })
  console.log('First decision:', firstResult)

  section('Second observation (same text, expected: novelty penalty)')
  const secondResult = await acquisition.consider({
    text,
    speakerId,
    targetId,
    direction: 'incoming',
    sourceType: 'user',
    channels: ['high-engagement']
  })
  console.log('Second decision:', secondResult)
  const pairStats = acquisition.getPairStats(speakerId, targetId)
  console.log('Pair stats:', pairStats)
  assert(pairStats.seenCount === 2, `Expected seenCount=2, got ${pairStats.seenCount}`)
  assert(pairStats.uniqueTexts === 1, `Expected uniqueTexts=1, got ${pairStats.uniqueTexts}`)
  assert(secondResult.score <= firstResult.score, `Expected second score <= first score, got first=${firstResult.score}, second=${secondResult.score}`)
  const stats = acquisition.getStats()
  console.log('Global stats after two considers:', stats)
  assert(stats.accepted + stats.rejected + stats.deferred === 2, 'Total decisions should equal number of considers (2)')
  console.log('✅ Acquisition pair-level novelty and stats behave as expected')
}

async function runAllAcquisitionTests() {
  try {
    await basicAcquisitionDecisionTest()
    await pairNoveltyAndStatsTest()
    banner('ALL ACQUISITION TESTS COMPLETE')
    process.exit(1)
  } catch (error) {
    console.error('\n❌ ACQUISITION TESTS FAILED:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

await runAllAcquisitionTests()