# Macro Data Sequencer — How It Works

## What Is It?

The Macro Data Sequencer (MDS) is a real-time global macro-economic dashboard that tracks 30+ economic indicators across 6 regions (US, UK, EU, Japan, APAC, LATAM). It automatically classifies the current macroeconomic environment into one of **4 Phases** and provides asset allocation guidance for each.

Data is sourced live from **FRED** (Federal Reserve Economic Data) and **Financial Modeling Prep** (treasury yields + economic calendar).

---

## The 4 Phases

The MDS places the economy into one of four macro regimes based on two axes: **Growth** and **Inflation**. Each axis is either accelerating or decelerating.

| Phase | Growth | Inflation | Nickname |
|-------|--------|-----------|----------|
| **Phase 1** | Accelerating | Decelerating | **Goldilocks** |
| **Phase 2** | Accelerating | Accelerating | **Reflation** |
| **Phase 3** | Decelerating | Accelerating | **Stagflation** |
| **Phase 4** | Decelerating | Decelerating | **Deflation** |

A **Transitional** state is shown when signals are mixed (neither clearly accelerating nor decelerating on one or both axes).

---

## How Phases Are Determined

### Step 1: Classify Each Indicator

Every indicator is tagged as either a **Growth** or **Inflation** measure. The system computes each indicator's year-over-year (YoY) rate-of-change, then measures whether that rate is **accelerating** (getting better) or **decelerating** (getting worse).

An indicator is considered "accelerating" when its smoothed 3-month trend, normalized by its own volatility, exceeds a small noise threshold.

### Step 2: Measure Breadth

**Breadth** is the percentage of indicators on each axis that are accelerating. Indicators are weighted by importance:

| Weight | Applies To |
|--------|------------|
| **2.0x** | Core US indicators (Unemployment, CPI, Core CPI, Payrolls, Retail Sales, Industrial Production) |
| **1.5x** | Leading indicators (Housing Permits, Housing Starts, Philly Fed, Jobless Claims, Consumer Sentiment, Durable Goods, Composite Leading Indicators) |
| **1.0x** | Standard international indicators |

### Step 3: Assign the Phase

- **Breadth > 55%** = Accelerating
- **Breadth < 45%** = Decelerating
- **45-55%** = Flat / Transitional

Growth breadth and Inflation breadth together determine which of the 4 phases (or Transitional) the economy sits in.

---

## How Individual Indicator Scores Work

Each indicator receives a composite score from **-5 to +5**, built from three components:

| Component | Weight | What It Measures |
|-----------|--------|------------------|
| **3-Month Acceleration Trend** | 1.5x | Smoothed second derivative of YoY — the momentum of the trend |
| **Latest Monthly Acceleration** | 1.0x | Most recent month's change in YoY |
| **Trend Position** | 0.5x | How the latest YoY compares to its 12-month moving average |

All values are normalized by the indicator's own historical volatility, allowing fair comparison across indicators with very different scales (e.g., CPI moves in tenths of a percent while Housing Permits move in thousands).

### Score Color Guide

| Color | Score Range | Signal |
|-------|-------------|--------|
| Dark Green | +3.0 or higher | Strongly Bullish |
| Medium Green | +1.5 to +3.0 | Moderately Bullish |
| Light Green | +0.5 to +1.5 | Slightly Bullish |
| Neutral | -0.5 to +0.5 | Neutral |
| Light Red | -0.5 to -1.5 | Slightly Bearish |
| Medium Red | -1.5 to -3.0 | Moderately Bearish |
| Dark Red | -3.0 or lower | Strongly Bearish |

---

## How to Use the Dashboard

### Filters & Controls

- **Region Tabs** (ALL, US, UK, EU, JAPAN, APAC, LATAM): Filter indicators by geography
- **Signal Filter** (ALL, BEARISH, BULLISH): Show only negative or positive scoring indicators
- **Search Bar**: Search by indicator name, region, or category
- **Column Headers**: Click to sort by score, rate-of-change, YoY values, etc.
- **Row Tooltips**: Hover any indicator row for a detailed breakdown of its macro axis, weight tier, and scoring components

### Key Panels

- **Stats Bar**: Shows bullish/bearish counts, growth & inflation breadth percentages, and a visual quad grid highlighting the current phase
- **Treasury Yields**: Live 3-month, 2-year, 10-year, and 30-year US Treasury yields plus the 2s10s spread
- **Economic Calendar**: Upcoming high and medium-impact economic data releases over the next 14 days
- **Sparklines**: Each indicator row includes a mini chart of its last 12 months of YoY data

### Reading the Table

Each row represents one indicator and shows:
- **Score**: The composite -5 to +5 signal (color-coded)
- **RoC**: Latest monthly rate-of-change (acceleration/deceleration)
- **3m RoC**: 3-month smoothed acceleration
- **Seq Prior / Latest**: Previous and current YoY values
- **12m MA**: 12-month moving average of the YoY series
- **Spark**: Visual trend of the last 12 months

---

## Sectors & Assets That Perform Best in Each Phase

### Phase 1: Goldilocks (Growth Up, Inflation Down)

The ideal macro environment. The economy is expanding while price pressures are easing.

**Best-Performing Sectors:**
- **Technology** — Growth stocks thrive when the economy expands and rates stay contained
- **Consumer Discretionary** — Rising incomes and confidence boost spending
- **Communication Services** — Advertising and digital spend expand with growth
- **Financials** — Loan growth improves; credit conditions ease

**Favored Assets:**
- Growth equities and broad equity indices
- Investment-grade bonds (benefit from stable/falling rates)
- US Dollar (relative strength attracts capital)

---

### Phase 2: Reflation (Growth Up, Inflation Up)

The economy is running hot. Both growth and prices are rising.

**Best-Performing Sectors:**
- **Energy** — Oil and gas prices rise with demand and inflation
- **Materials** — Commodity-linked companies benefit from rising input prices
- **Industrials** — Capex and infrastructure spending expand
- **Financials** — Banks benefit from steepening yield curves and loan demand

**Favored Assets:**
- Cyclical equities and value stocks
- Commodities (oil, copper, agriculture)
- TIPS (Treasury Inflation-Protected Securities)
- Real estate / REITs

---

### Phase 3: Stagflation (Growth Down, Inflation Up)

The worst macro environment. Growth is slowing while inflation persists.

**Best-Performing Sectors:**
- **Energy** — Often the only equity sector that holds up, driven by supply constraints
- **Healthcare** — Defensive, inelastic demand
- **Consumer Staples** — Essential goods with pricing power
- **Utilities** — Stable cash flows; defensive positioning

**Favored Assets:**
- Cash and money market funds
- Gold and precious metals
- Commodities (supply-driven inflation benefits producers)
- Short equity positions or inverse ETFs

---

### Phase 4: Deflation (Growth Down, Inflation Down)

The economy is contracting and prices are falling. Central banks typically cut rates.

**Best-Performing Sectors:**
- **Utilities** — Bond-proxy equities benefit from falling rates
- **Healthcare** — Recession-resistant demand
- **Consumer Staples** — Defensive, essential spending
- **Real Estate (select)** — Rate-sensitive sectors benefit as yields drop

**Favored Assets:**
- Long-duration US Treasuries (rally as rates fall)
- Gold (safe haven + real rate beneficiary)
- Defensive equity sectors
- High-quality dividend stocks

---

### Transitional Phase

Signals are mixed — the economy is shifting between regimes.

**Approach:**
- Reduce portfolio concentration
- Avoid large directional bets
- Diversify across asset classes
- Wait for clearer signals before repositioning aggressively

---

## Data Sources

| Source | What It Provides | Refresh |
|--------|-----------------|---------|
| **FRED** (St. Louis Fed) | All 30 economic indicator series (YoY changes, levels, diffusion indices) | Every 60 minutes |
| **Financial Modeling Prep** | US Treasury yields (3M, 2Y, 10Y, 30Y), 2s10s spread, economic calendar | Every 60 minutes |

---

## The 30 Tracked Indicators

### US (12 indicators)
- Building Permits, Housing Starts, Philly Fed Manufacturing, Initial Jobless Claims, Consumer Sentiment, Unemployment Rate, CPI, Core CPI, Nonfarm Payrolls, Retail Sales, Industrial Production, Durable Goods Orders

### UK (4 indicators)
- Consumer Confidence, Unemployment Rate, CPI, Composite Leading Indicator

### EU (5 indicators)
- Consumer Confidence, Unemployment Rate, Germany CLI, France CLI, CPI

### Japan (5 indicators)
- CLI, CPI, Consumer Confidence, Unemployment Rate, Industrial Production

### APAC (2 indicators)
- Australia CLI, Australia Unemployment Rate

### LATAM (2 indicators)
- Mexico Unemployment Rate, Brazil CLI

---

## Quick-Start Checklist

1. **Check the Phase** — Look at the stats bar to see which of the 4 phases (or Transitional) the economy is in
2. **Review Breadth** — Are most growth indicators accelerating or decelerating? Same for inflation
3. **Scan the Scores** — Green rows are bullish; red rows are bearish. Sort by score to find the strongest/weakest signals
4. **Check the Calendar** — See what upcoming data releases could shift the picture
5. **Position Accordingly** — Use the phase-based sector and asset guidance above to align your portfolio
