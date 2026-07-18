# KASTRO — Development Handoff
**Version:** 1.0 Final · **Design Locked:** 2025-07-15
**Platform:** Bilingual (Arabic / English) Employee Learning & Gaming — Performance Evaluation Section Pilot
**Prototype scope:** Frontend only. No authentication, database, multiplayer, or real game logic.

---

## Table of Contents
1. [Project Stack](#1-project-stack)
2. [Folder Structure](#2-folder-structure)
3. [Color System](#3-color-system)
4. [Typography](#4-typography)
5. [Spacing & Radius](#5-spacing--radius)
6. [Design Tokens (CSS Variables)](#6-design-tokens-css-variables)
7. [Component Library (CSS Classes)](#7-component-library-css-classes)
8. [Admin Dashboard Tokens (`S` object)](#8-admin-dashboard-tokens-s-object)
9. [Animation System](#9-animation-system)
10. [Icons](#10-icons)
11. [Screen Inventory](#11-screen-inventory)
12. [Navigation & Routing](#12-navigation--routing)
13. [Access Control](#13-access-control)
14. [RTL / Bilingual System](#14-rtl--bilingual-system)
15. [Admin Dashboard — Feature Map](#15-admin-dashboard--feature-map)
16. [Data Interfaces (TypeScript)](#16-data-interfaces-typescript)
17. [API Endpoints (TODO)](#17-api-endpoints-todo)
18. [Developer Notes & Implementation TODOs](#18-developer-notes--implementation-todos)

---

## 1. Project Stack

| Layer | Technology |
|---|---|
| Framework | React 19 |
| Language | TypeScript |
| Build tool | Vite 8 |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite` — no PostCSS config needed) |
| Fonts | Google Fonts via `@import` in `src/index.css` |
| State | Local `useState` / `useEffect` — no external state library |
| Routing | Manual `Screen` union type + `useState` — no React Router |
| Package manager | pnpm |

---

## 2. Folder Structure

```
src/
  App.tsx                  ← Root: navigation state, lang toggle, admin guard
  main.tsx                 ← React entry point
  index.css                ← All global CSS: variables, tokens, animations, utilities
  screens/
    LoginScreen.tsx
    HomeScreen.tsx
    GamesLibraryScreen.tsx
    CasualGameScreen.tsx
    WorkGameScreen.tsx
    GameLobbyScreen.tsx
    LeaderboardScreen.tsx
    ProfileScreen.tsx
    AchievementsScreen.tsx
    RewardsScreen.tsx
    SeasonPassScreen.tsx
    TournamentScreen.tsx
    FriendsScreen.tsx
    WeeklyChallengeScreen.tsx
    AdminDashboardScreen.tsx
```

---

## 3. Color System

### Core Palette

| Token | Value | Usage |
|---|---|---|
| `--background` | `#03030f` | Page background |
| `--surface-1` | `#08081e` | Elevated surface (nav, modals) |
| `--surface-2` | `#0d0d28` | Secondary surface (cards, inputs) |
| `--surface-3` | `rgba(255,255,255,0.04)` | Subtle overlay |
| `--foreground` | `#eeeeff` | Primary text |
| `--foreground-muted` | `rgba(200,200,255,0.65)` | Secondary text |
| `--foreground-dim` | `rgba(180,180,230,0.45)` | Disabled / placeholder text |

### Brand Colors

| Name | Token | Hex | Glow |
|---|---|---|---|
| Violet (primary) | `--violet` | `#7c3aed` | `rgba(124,58,237,0.35)` |
| Violet bright | `--violet-bright` | `#9d6fff` | — |
| Cyan (accent) | `--cyan` | `#00d4ff` | `rgba(0,212,255,0.3)` |
| Gold | `--gold` | `#ffd700` | `rgba(255,215,0,0.35)` |
| Gold light | `--gold-light` | `#ffe94d` | — |
| Fire | `--fire` | `#ff6b35` | `rgba(255,107,53,0.35)` |
| Emerald | `--emerald` | `#00e676` | `rgba(0,230,118,0.25)` |
| Rose (danger) | `--rose` | `#ff4785` | `rgba(255,71,133,0.25)` |

### Rank Tier Colors

| Rank | Color |
|---|---|
| Bronze | `#cd7f32` |
| Silver | `#c0c0c0` |
| Gold | `#ffd700` |
| Diamond | `#00d4ff` |
| Legend | `#ff6b35` |

### Badge Rarity Colors

| Rarity | Color |
|---|---|
| Common | `#9ca3af` |
| Rare | `#60a5fa` |
| Epic | `#c084fc` |
| Legendary | `#ffd700` |

---

## 4. Typography

### Font Families

| Purpose | Font | Weights | Usage |
|---|---|---|---|
| Gaming display (EN) | **Exo 2** | 300–900 | Headlines, XP numbers, scoreboard |
| Body / UI (EN) | **Inter** | 300–800 | All general UI, forms, labels |
| Arabic body & UI | **Cairo** | 400–900 | All text when `lang === 'ar'` |
| Code / monospace | **JetBrains Mono** | 400, 600 | Access codes, timestamps, IDs |

All fonts loaded via Google Fonts in `src/index.css` line 1:
```css
@import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700;800&family=Cairo:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap');
```

### Typography CSS Classes

```css
.font-display   /* Exo 2 — gaming headers */
.font-cairo     /* Cairo — Arabic text */
.font-mono      /* JetBrains Mono — codes, timestamps */
[dir="rtl"]     /* Auto-switches to Cairo */
[lang="ar"]     /* Auto-switches to Cairo */
```

### Type Scale (informal, used inline)

| Size | Usage |
|---|---|
| 9px | Nav labels, badge rarity |
| 10–11px | Section headers (uppercase, tracked), metadata |
| 12–13px | Body small, secondary info, admin UI |
| 14–15px | Body default, buttons, inputs |
| 16–18px | Card titles, tab headers |
| 20–22px | XP floats, code preview |
| 24–32px+ | Level numbers, leaderboard ranks |

---

## 5. Spacing & Radius

### Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius` | `18px` | Default card radius |
| `.card` | `20px` | Standard card |
| `.card-sm` | `14px` | Compact card |
| `.card-lg` | `24px` | Large card / hero |
| Admin `S.card` | `12px` | Admin dashboard cards |
| Admin `S.sheetIn` | `20px 20px 0 0` | Bottom sheet top corners |
| Admin `S.dbox` | `16px` | Dialog box |
| Admin `S.input` | `8px` | Admin form inputs |
| Pill / badge | `20px` (99px) | Status pills, badges |
| Button (admin) | `8px` | Admin action buttons |
| Button (main app) | `14px` | Primary / ghost buttons |

### Padding

| Component | Padding |
|---|---|
| Admin card (`S.card`) | `14px 16px` |
| Admin input (`S.input`) | `10px 12px` |
| Admin primary button | `9px 16px` |
| Admin ghost button | `8px 14px` |
| Status pill | `3px 10px` |
| Main input | `14px 16px` |
| Main button primary | `14px 28px` |
| Sheet inner | `20px 18px 36px` |
| Bottom nav item | `10px 6px` |

### Spacing (gap / margin)

| Context | Gap |
|---|---|
| Admin tab column | `16px` |
| Admin card content | `8–12px` |
| Admin section grid | `10px` |
| Button row | `8px` |
| Form fields | `14px` |
| Nav items | flex equal |

---

## 6. Design Tokens (CSS Variables)

Complete token map in `src/index.css :root {}`:

```css
/* Semantic tokens — used by Tailwind @theme inline */
--primary:              var(--violet)          /* #7c3aed */
--primary-foreground:   #ffffff
--card:                 var(--surface-3)       /* rgba(255,255,255,0.04) */
--card-foreground:      var(--foreground)      /* #eeeeff */
--secondary:            var(--surface-2)       /* #0d0d28 */
--secondary-foreground: var(--foreground-muted)
--muted:                var(--surface-2)
--muted-foreground:     var(--foreground-dim)
--accent:               var(--cyan)            /* #00d4ff */
--accent-foreground:    #03030f
--border:               rgba(255,255,255,0.07)
--ring:                 var(--violet)
--radius:               18px
```

---

## 7. Component Library (CSS Classes)

### Glass System

```css
.glass         /* bg rgba(255,255,255,0.04) + blur(24px) + border rgba(255,255,255,0.08) */
.glass-violet  /* bg rgba(124,58,237,0.08) + blur(24px) + border rgba(124,58,237,0.2) */
.glass-gold    /* bg rgba(255,215,0,0.06)  + blur(20px) + border rgba(255,215,0,0.2) */
.glass-fire    /* bg rgba(255,107,53,0.07) + blur(20px) + border rgba(255,107,53,0.2) */
.glass-cyan    /* bg rgba(0,212,255,0.06)  + blur(20px) + border rgba(0,212,255,0.18) */
```

### Cards

```css
.card      /* glass + border-radius 20px */
.card-sm   /* border-radius 14px modifier */
.card-lg   /* border-radius 24px modifier */
.card-hover /* translateY(-4px) on hover; scale(0.97) on active */
```

### Glow Utilities

```css
.glow-violet  /* box-shadow 0 0 24px rgba(124,58,237,0.35), 0 0 60px rgba(124,58,237,0.08) */
.glow-cyan    /* box-shadow 0 0 24px rgba(0,212,255,0.3),   0 0 60px rgba(0,212,255,0.06) */
.glow-gold    /* box-shadow 0 0 24px rgba(255,215,0,0.35),  0 0 60px rgba(255,215,0,0.08) */
.glow-fire    /* box-shadow 0 0 24px rgba(255,107,53,0.35) */
```

### Rank Auras (avatar ring + glow)

```css
.aura-bronze   /* 2px ring #cd7f32 @ 50% + glow 20px */
.aura-silver   /* 2px ring #c0c0c0 @ 50% + glow 20px */
.aura-gold     /* 2px ring #ffd700 @ 60% + glow 20px */
.aura-diamond  /* 2px ring #00d4ff @ 60% + glow 24px */
.aura-legend   /* 2px ring #ff6b35 @ 70% + glow 30px + violet halo 60px */
```

### Gradient Utilities

```css
/* Background gradients */
.grad-violet   /* 135deg #7c3aed → #5b21b6 */
.grad-cyan     /* 135deg #00d4ff → #0099cc */
.grad-gold     /* 135deg #ffd700 → #f59e0b */
.grad-fire     /* 135deg #ff6b35 → #e53e3e */
.grad-emerald  /* 135deg #00e676 → #059669 */
.grad-rose     /* 135deg #ff4785 → #9d174d */
.grad-cosmic   /* 135deg #7c3aed → #00d4ff */
.grad-aurora   /* 135deg #ff6b35 → #7c3aed → #00d4ff */

/* Text clip gradients */
.grad-text-violet  /* #c4b5fd → #7c3aed */
.grad-text-gold    /* #ffe94d → #ffd700 */
.grad-text-cosmic  /* #c4b5fd → #00d4ff */
.grad-text-fire    /* #ffd700 → #ff6b35 */

/* Text color utilities */
.text-violet  .text-cyan  .text-gold  .text-gold-light
.text-fire    .text-emerald  .text-muted  .text-dim
```

### Buttons

```css
/* Base */
.btn           /* border-radius 14px, font-weight 700, transition all 0.2s */

/* Variants */
.btn-primary   /* grad-violet + white text + violet glow shadow */
.btn-gold      /* grad-gold  + dark text + gold glow shadow */
.btn-fire      /* grad-fire  + white text + fire glow shadow */
.btn-ghost     /* rgba(255,255,255,0.06) bg + border rgba(255,255,255,0.1) */

/* Sizes */
.btn-sm        /* padding 8px 16px, font-size 13px, border-radius 10px */
.btn-xs        /* padding 6px 12px, font-size 11px, border-radius 8px */
```

### Inputs

```css
input, textarea {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 14px;
  padding: 14px 16px;
  font-size: 15px;
  /* focus: border rgba(124,58,237,0.5), ring rgba(124,58,237,0.12) */
}
```

### Badges (status pills in main app)

```css
.badge         /* 10px, font-weight 800, padding 3px 8px, border-radius 99px, uppercase */
.badge-new     /* gold gradient, dark text */
.badge-hot     /* rose gradient, white text */
.badge-live    /* emerald gradient, dark text + pulse animation */
.badge-boost   /* cyan gradient, dark text */
.badge-soon    /* ghost style, low opacity */
```

### XP Bar

```css
.xp-track      /* bg rgba(255,255,255,0.06), border-radius 99px, overflow hidden */
.xp-fill       /* linear-gradient(90deg, #7c3aed, #00d4ff), transition width 1.4s cubic */
               /* ::after — white glint on right edge */
.xp-fill-gold  /* linear-gradient(90deg, #f59e0b, #ffd700) */
.xp-fill-fire  /* linear-gradient(90deg, #ff6b35, #ffd700) */
.xp-fill-burst /* burst glow animation on XP award */
```

### Bottom Nav

```css
.bottom-nav    /* fixed bottom, bg rgba(3,3,15,0.92), blur(40px), border-top */
.nav-item      /* flex column, padding 10px 6px, transition */
.nav-item.active .nav-label  /* color #9d6fff */
.nav-item:not(.active)       /* opacity 0.55, grayscale(0.3) */
.nav-pip       /* 5px violet dot indicator */
.pb-nav        /* padding-bottom calc(80px + safe-area-inset-bottom) */
```

### Background Textures

```css
.bg-game       /* radial violet + cyan + fire gradients over --background */
.bg-stars      /* 5-point radial dot texture for star field effect */
```

### Live / Status Indicators

```css
.live-dot      /* 6px emerald circle, live-pulse animation */
.streak-fire   /* 22px fire emoji with drop-shadow + fire-dance animation */
```

### Leaderboard Podium

```css
.podium-glow-1  /* gold ring + glow — 1st place */
.podium-glow-2  /* cyan ring + glow — 2nd place */
.podium-glow-3  /* fire ring + glow — 3rd place */
```

### Rank Change Indicators

```css
.rank-up    /* color #00e676, rank-delta-in animation */
.rank-down  /* color #ff4785, rank-delta-in animation */
.rank-same  /* opacity label, no animation */
```

### Rarity Labels

```css
.rarity-common    /* #9ca3af */
.rarity-rare      /* #60a5fa */
.rarity-epic      /* #c084fc */
.rarity-legendary /* #ffd700 */
```

### Game World Themes (card backgrounds)

| Class | Colors |
|---|---|
| `.world-safety` | Deep red tones |
| `.world-procedure` | Deep blue tones |
| `.world-target` | Deep green tones |
| `.world-compliance` | Deep purple tones |
| `.world-process` | Deep teal tones |
| `.world-data` | Deep navy tones |
| `.world-team` | Deep amber tones |
| `.world-policy` | Deep yellow tones |
| `.world-clash` | Deep rose tones |
| `.world-puzzle` | Deep emerald tones |

### Season Pass Nodes

```css
.season-node          /* 44×44px circle, font-size 18px */
.season-node.claimed  /* cosmic gradient + violet glow */
.season-node.current  /* gold gradient + gold glow + pulse-ring animation */
.season-node.locked   /* ghost bg + dashed border + grayscale + opacity 0.5 */
```

### Tournament Bracket

```css
.bracket-match           /* card with overflow hidden */
.bracket-player          /* padding 8px 12px, font-size 13px */
.bracket-player.winner   /* violet-tinted bg + violet left border */
```

### Misc

```css
.sep           /* 1px separator, rgba(255,255,255,0.06) */
.scroll-x      /* horizontal scroll container, no scrollbar */
.no-select     /* user-select: none */
.truncate      /* text-overflow ellipsis */
.shimmer-bg    /* 200% shimmer animation for loading states */
.screen        /* min-height 100dvh */
```

---

## 8. Admin Dashboard Tokens (`S` object)

Defined in `AdminDashboardScreen.tsx` as inline CSSProperties. Use these exact values when reimplementing:

```typescript
const S = {
  card:    { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:12, padding:'14px 16px' },
  pill:    { display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600, letterSpacing:0.4 },
  primary: { display:'inline-flex', alignItems:'center', gap:6, padding:'9px 16px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#7c3aed,#9d6fff)', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer' },
  ghost:   { display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'transparent', color:'rgba(200,200,255,0.75)', fontSize:13, fontWeight:600, cursor:'pointer' },
  danger:  { display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:8, border:'1px solid rgba(255,71,133,0.4)', background:'transparent', color:'#ff4785', fontSize:13, fontWeight:600, cursor:'pointer' },
  input:   { width:'100%', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, padding:'10px 12px', color:'#e8e8ff', fontSize:13, outline:'none' },
  sheet:   { position:'fixed', inset:0, background:'rgba(3,3,15,0.88)', zIndex:9000, display:'flex', alignItems:'flex-end', justifyContent:'center' },
  sheetIn: { background:'#0d0d1f', borderRadius:'20px 20px 0 0', width:'100%', maxWidth:480, maxHeight:'88dvh', overflowY:'auto', padding:'20px 18px 36px' },
  dialog:  { position:'fixed', inset:0, background:'rgba(3,3,15,0.92)', zIndex:9100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 },
  dbox:    { background:'#0d0d1f', borderRadius:16, padding:24, maxWidth:320, width:'100%', border:'1px solid rgba(255,255,255,0.1)' },
  handle:  { width:36, height:4, borderRadius:2, background:'rgba(255,255,255,0.15)', margin:'0 auto 16px' },
  label:   { fontSize:11, color:'rgba(200,200,255,0.45)', marginBottom:4, display:'block' },
  sectionHead: { fontSize:11, fontWeight:700, color:'rgba(200,200,255,0.45)', textTransform:'uppercase', letterSpacing:0.8, marginBottom:10 },
}
```

**z-index layers:**
- Sheet overlay: `9000`
- Dialog overlay: `9100`
- Toast: `9200`

---

## 9. Animation System

### Keyframes (defined in `src/index.css`)

| Name | Description |
|---|---|
| `slide-up` | opacity 0→1 + translateY(24px)→0 |
| `scale-in` | opacity 0→1 + scale(0.9)→1 |
| `level-burst` | scale bounce: 0.5→1.15→0.95→1 |
| `float` | translateY 0→-8px→0, 3s loop |
| `crown-float` | translateY + rotate, 2.5s loop |
| `neon-flicker` | opacity flicker at 96%–98% of 4s cycle |
| `shimmer` | bg-position -200%→200%, 2.4s loop |
| `badge-live-pulse` | box-shadow expand/fade, 2s loop |
| `fire-dance` | scaleY + rotate, 0.8s alternate |
| `live-pulse` | opacity + scale 1→0.5, 1.4s loop |
| `float-up` | XP float label: opacity 0→1→0 + translateY -60px |
| `shake` | horizontal shake 4px, 5-step |
| `orbit` | rotate around 20px radius |
| `ticker` | translateX 0→-50% (news ticker) |
| `xp-bar-glow` | box-shadow color cycle violet→cyan, 2s |
| `confetti-cascade` | translateY 100vh + drift + rotate 720deg |
| `badge-reveal` | scale 0→1.2→0.92→1 + rotate |
| `rank-delta-in` | translateY(6px)→0 + scale 0.8→1 |
| `rank-up-anim` | translateY(12px)→0 + bg flash green |
| `rank-down-anim` | translateY(-8px)→0 |
| `xp-fill-burst` | box-shadow ring expand/fade |
| `glow-pulse` | brightness + drop-shadow cycle |
| `pulse-ring` | scale 1→1.4 + opacity fade |
| `skeleton-pulse` | opacity pulse for skeleton shimmer |
| `toast-in` | slide-up + fade for toast notification |

### Animation Utility Classes

```css
.animate-slide-up      /* slide-up 0.4s cubic-bezier(0.4,0,0.2,1) */
.animate-scale-in      /* scale-in 0.35s cubic-bezier(0.4,0,0.2,1) */
.animate-level-burst   /* level-burst 0.6s cubic-bezier */
.animate-float         /* float 3s ease-in-out infinite */
.animate-crown         /* crown-float 2.5s ease-in-out infinite */
.animate-neon          /* neon-flicker 4s ease-in-out infinite */
.animate-badge-reveal  /* badge-reveal 0.7s cubic-bezier */
.animate-glow-pulse    /* glow-pulse 2s ease-in-out infinite */
.animate-rank-up       /* rank-up-anim 0.6s cubic-bezier */
.animate-rank-down     /* rank-down-anim 0.5s ease */
.xp-fill-burst         /* xp-fill-burst 0.6s ease-out (one-shot) */
.shimmer-bg            /* shimmer 2.4s linear infinite */
```

### Production Animation Spec (Admin Dashboard)

| Interaction | Animation |
|---|---|
| Tab switch | fade-in `150ms ease-out` (opacity 0→1) |
| Sheet open | slide-up `280ms cubic-bezier(0.32,0.72,0,1)` |
| Sheet close | slide-down `220ms ease-in` |
| Toast | slide-up + fade `250ms ease-out`, auto-dismiss 2s |
| Skeleton shimmer | opacity pulse `1.4s infinite` |
| Copy button | color swap `200ms ease` + checkmark scale 0→1.2→1 |
| Stat card hover | `translateY(-2px) 150ms ease` |
| Bar fill (charts) | width 0→final `600ms ease-out` on mount |

---

## 10. Icons

All icons are inline SVG React components in `AdminDashboardScreen.tsx`. Size 13–20px, stroke-based, `stroke="currentColor"`.

| Component | SVG Path | Usage |
|---|---|---|
| `IcoUsers` | Users + person | Users tab |
| `IcoKey` | Key | Codes tab |
| `IcoBar` | Bar chart lines | Games tab |
| `IcoMega` | Send/cursor arrow | Announcements tab |
| `IcoLog` | Clipboard | Log tab |
| `IcoGrid` | 4 squares | Overview tab |
| `IcoSearch` | Magnifier + circle | Search input |
| `IcoCopy` | Overlapping rectangles | Copy code button |
| `IcoCheck` | Checkmark polyline | Copy success state |
| `IcoDown` | Download arrow | Export buttons |
| `IcoRefresh` | Circular arrow | Regenerate code |
| `IcoX` | ✕ cross lines | Close / cancel |
| `IcoBack` | `<` chevron (20px) | Back navigation |
| `IcoPin` | Pin/thumbtack | Pinned announcement |
| `IcoClock` | Clock circle | Scheduled indicator |

### Log Category Icons (emoji)

| Category | Icon | Color |
|---|---|---|
| `users` | 👤 | `#9d6fff` |
| `codes` | 🔑 | `#00d4ff` |
| `xp` | ⭐ | `#ffd700` |
| `badges` | 🏆 | `#ff6b35` |
| `security` | 🔒 | `#ff4785` |
| `announcements` | 📢 | `#00e676` |

---

## 11. Screen Inventory

| Screen | File | Description |
|---|---|---|
| `login` | `LoginScreen.tsx` | Email + password login, owner detection |
| `home` | `HomeScreen.tsx` | Dashboard with streak, quick actions |
| `games` | `GamesLibraryScreen.tsx` | Game catalog |
| `casual` | `CasualGameScreen.tsx` | Casual quiz game |
| `work` | `WorkGameScreen.tsx` | Work/professional game |
| `lobby` | `GameLobbyScreen.tsx` | Pre-game lobby |
| `leaderboard` | `LeaderboardScreen.tsx` | Rankings |
| `profile` | `ProfileScreen.tsx` | User profile, settings, admin link |
| `achievements` | `AchievementsScreen.tsx` | Badges & milestones |
| `rewards` | `RewardsScreen.tsx` | Rewards catalog |
| `season` | `SeasonPassScreen.tsx` | Season pass track |
| `tournament` | `TournamentScreen.tsx` | Bracket tournament |
| `friends` | `FriendsScreen.tsx` | Friends & social |
| `weekly` | `WeeklyChallengeScreen.tsx` | Weekly challenge |
| `admin` | `AdminDashboardScreen.tsx` | **Owner only** — admin panel |

---

## 12. Navigation & Routing

Navigation is managed entirely via `useState<Screen>` in `App.tsx`:

```typescript
type Screen =
  'login' | 'home' | 'games' | 'casual' | 'work' | 'lobby' |
  'leaderboard' | 'profile' | 'achievements' | 'rewards' |
  'season' | 'tournament' | 'friends' | 'weekly' | 'admin'
```

**Safe navigate guard** (in `App.tsx`):
```typescript
const safeNavigate = (s: Screen) => {
  if (s === 'admin' && userRole !== 'owner') return
  setScreen(s)
}
```

All screens receive `onNavigate: (s: Screen) => void`. Screens call `onNavigate('home')` etc. to transition.

**Lang toggle** (in `App.tsx`):
```typescript
type Lang = 'en' | 'ar'
const [lang, setLang] = useState<Lang>('en')
```
RTL is applied via `dir` attribute on the root container when `lang === 'ar'`.

---

## 13. Access Control

### Owner Account (hardcoded for pilot)

```typescript
// src/App.tsx
export const OWNER_EMAIL = 'muraikhi13@gmail.com'
```

### Role System

```typescript
export type UserRole = 'owner' | 'player'
// All new accounts = 'player'. No self-promotion possible.
```

### Three-Layer Admin Guard

1. **Login detection** (`LoginScreen.tsx`): `email.trim().toLowerCase() === OWNER_EMAIL` → sets role `'owner'`
2. **Navigate guard** (`App.tsx`): `safeNavigate` blocks `admin` for non-owners
3. **Render guard** (`App.tsx`):
   ```tsx
   {screen === 'admin' && userRole === 'owner'
     ? <AdminDashboardScreen ... />
     : screen === 'admin' && <div>403 — Access forbidden</div>
   }
   ```
4. **ProfileScreen**: Admin Dashboard link only rendered when `userRole === 'owner'`

**Critical:** Admin Dashboard must be completely absent for all non-owner accounts — not disabled, not locked, not "coming soon". The link must not appear and the route must return 403.

---

## 14. RTL / Bilingual System

Every screen accepts `lang: Lang` prop. Text is rendered via inline ternary:
```tsx
{lang === 'ar' ? 'النص العربي' : 'English text'}
```

RTL layout is applied by setting `dir="rtl"` on the root container element when `lang === 'ar'`. Cairo font auto-applies via:
```css
[dir="rtl"], [lang="ar"] { font-family: 'Cairo', sans-serif; }
```

**Admin dashboard** also receives `setLang` prop to allow language switching from within the admin panel.

---

## 15. Admin Dashboard — Feature Map

**File:** `src/screens/AdminDashboardScreen.tsx`
**Access:** OWNER only (`muraikhi13@gmail.com`)
**Design:** LOCKED v1.0 Final — do not modify visual structure

### Tabs

| Tab | Key | Features |
|---|---|---|
| Overview | `overview` | 6 stat cards (computed from users), quick insights, DAU bar chart |
| Users | `users` | Search, 10 sort/filter options, user cards, user detail sheet, 5 actions with confirms |
| Access Codes | `codes` | Code list with usage bars, create sheet with live preview, copy animation, view users sheet |
| Games Analytics | `games` | Per-game stat cards, bar charts (WAU/MAU), most played bars, avg score bars, question drill-down |
| Announcements | `announcements` | Create form (title/body/pin/schedule/expiry), pin indicator, expiry badge |
| Activity Log | `log` | Search input, 7 category filters, emoji category icons, export button |

### User Detail Sheet

Fields shown:
- Avatar initials + online dot
- Status pill: Active (emerald) / Suspended (rose)
- Role pill: Player (violet)
- Online/Last Seen pill (cyan if online, dim if offline)
- Stats grid (8 cells): Level, XP, Games Played, Avg Score, Login Count, Last Active, Registered, Access Code
- Badges (flex-wrap)
- Actions: Adjust XP, Give Badge, Suspend/Activate (with confirmation), Reset Password, Delete Account (with confirmation)

### Code Create Form Fields

- Note / label (text input)
- Max uses (number input + "Unlimited" checkbox)
- Expiry (radio: Never / 7 days / 30 days / Custom date)
- Code (text input + auto-generate button)
- **Live preview card** — shows final code, uses, expiry, note before creating

---

## 16. Data Interfaces (TypeScript)

```typescript
interface SampleUser {
  id: string
  username: string
  email: string
  role: 'player'
  status: 'active' | 'suspended'
  isOnline: boolean
  level: number
  xp: number
  loginCount: number
  lastActive: string        // 'YYYY-MM-DD'
  registeredAt: string      // 'YYYY-MM-DD'
  accessCode: string
  badges: string[]
  gamesPlayed: number
  avgScore: number          // 0–100
}

interface AccessCode {
  id: string
  code: string
  note: string
  maxUses: number | 'unlimited'
  uses: number
  status: 'active' | 'disabled'
  createdAt: string         // 'YYYY-MM-DD'
  expiresAt: string | 'never'
  createdBy: string         // email
}

interface AdminLogEntry {
  id: string
  timestamp: string         // 'YYYY-MM-DD HH:mm'
  action: string
  category: 'users' | 'codes' | 'xp' | 'badges' | 'security' | 'announcements'
  target: string
  detail: string
}

interface Announcement {
  id: string
  title: string
  body: string
  createdAt: string         // 'YYYY-MM-DD'
  pinned: boolean
  scheduledAt: string | null  // ISO datetime or null
  expiresAt: string | null    // 'YYYY-MM-DD' or null
}

// Game analytics shape (currently hardcoded in GAME_DATA)
interface GameStat {
  id: string
  name: string
  nameAr: string
  plays: number
  avgScore: number          // 0–100
  avgTime: string           // e.g. '4m 12s'
  hardestQ: string
  failedTopic: string
  uniquePlayers: number
  completion: number        // 0–100 (%)
}
```

---

## 17. API Endpoints (TODO)

All seed data in `AdminDashboardScreen.tsx` must be replaced with live API calls. Comments are present in the file marking each location.

| Endpoint | Method | Replaces |
|---|---|---|
| `/api/admin/users` | GET | `INIT_USERS` |
| `/api/admin/codes` | GET | `INIT_CODES` |
| `/api/admin/log` | GET | `INIT_LOG` |
| `/api/admin/announcements` | GET | `INIT_ANNOUNCEMENTS` |
| `/api/admin/analytics/games` | GET | `GAME_DATA` |
| `/api/admin/analytics/activity` | GET | `DAU_DATA`, `WAU_DATA`, `MAU_DATA` |
| `/api/admin/users/:id/suspend` | POST | `status: 'suspended'` |
| `/api/admin/users/:id/activate` | POST | `status: 'active'` |
| `/api/admin/users/:id/delete` | DELETE | remove from list |
| `/api/admin/users/:id/xp` | PATCH | `xp` field update |
| `/api/admin/users/:id/badge` | POST | badges array push |
| `/api/admin/users/:id/reset-password` | POST | password reset flow |
| `/api/admin/codes` | POST | create new code |
| `/api/admin/codes/:id/toggle` | PATCH | `status` toggle |
| `/api/admin/codes/:id` | DELETE | remove code |
| `/api/admin/announcements` | POST | create announcement |
| `/api/admin/announcements/:id/delete` | DELETE | remove announcement |

---

## 18. Developer Notes & Implementation TODOs

### Authentication
- Replace `OWNER_EMAIL` constant with a backend role check (`role === 'OWNER'` from JWT)
- Backend must enforce 403 on all `/api/admin/*` routes for non-owner tokens
- All new registrations default to `PLAYER` role — no self-promotion path

### Charts
- `DAU_DATA`, `WAU_DATA`, `MAU_DATA` are illustrative bar chart data — wire to real analytics API
- Charts use the `MiniBarChart` component (flex layout, proportional height bars)
- Bar fill should animate width `0 → value` on mount (`600ms ease-out`)
- WAU/MAU use the same `MiniBarChart` in `GamesTab`

### Skeleton / Loading
- Loading state is simulated with `setTimeout(900ms)` — replace with real loading flags
- Skeleton pulse animation: `skeleton-pulse` keyframe in `index.css` (not yet defined — add: `@keyframes skeleton-pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }`)
- Toast slide-in: `toast-in` keyframe (not yet defined — add: `@keyframes toast-in { from{opacity:0;transform:translateX(-50%) translateY(12px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }`)

### Responsive Breakpoints
- Target widths: 375px (iPhone SE), 430px (iPhone 16 Pro Max), 768px (iPad), 1280px (Desktop)
- Sheet (`S.sheetIn`) has `maxWidth: 480` — centers on desktop
- Admin tab bar scrolls horizontally on small screens (`overflow-x: auto`)
- All admin cards use single-column stacking — test for clipping at 375px

### Seed Data
- All usernames: `Pilot_User_1` through `Pilot_User_6`
- All emails: `pilot.N@organisation.qa`
- Access codes created by: `admin@organisation.qa`
- These are production placeholders — replace with real user data from API

### Removal Checklist Before Production
- [ ] Remove all `INIT_*` constants — fetch from API
- [ ] Remove `setTimeout(900ms)` loading simulation — use real loading state
- [ ] Replace `alert(...)` calls in export buttons with real export logic
- [ ] Replace `OWNER_EMAIL` constant with backend JWT role validation
- [ ] Wire game analytics to real event tracking
- [ ] Add `skeleton-pulse` and `toast-in` keyframes to `index.css`
- [ ] Implement all animation specs from section 9
- [ ] Add proper error boundaries and empty/error states for API failures
