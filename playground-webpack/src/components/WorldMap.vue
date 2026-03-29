<script setup lang="ts">
import { continents } from '../data'

const colorMap: Record<string, string> = {}
for (const c of continents) {
  colorMap[c.name] = c.color
}
</script>

<template>
  <div class="world-map">
    <svg viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg">
      <!-- Grid lines -->
      <g opacity="0.08" stroke="var(--text)" stroke-width="0.5">
        <line v-for="x in 9" :key="'v'+x" :x1="x*100" y1="0" :x2="x*100" y2="500" />
        <line v-for="y in 4" :key="'h'+y" x1="0" :y1="y*100" x2="1000" :y2="y*100" />
        <line x1="0" y1="250" x2="1000" y2="250" opacity="2" stroke-dasharray="4 4" />
      </g>

      <!-- Asia -->
      <path
        :fill="colorMap['Asia']"
        fill-opacity="0.25"
        :stroke="colorMap['Asia']"
        stroke-width="1.5"
        d="M580,80 L620,70 L680,75 L740,65 L780,80 L800,100 L810,130 L800,160 L820,180 L810,220 L780,240 L740,260 L700,270 L660,250 L630,260 L600,240 L580,260 L560,240 L550,200 L560,160 L540,140 L550,110 Z"
      />
      <text x="680" y="170" fill="var(--text)" font-size="13" font-weight="600" text-anchor="middle" opacity="0.9">Asia</text>

      <!-- Africa -->
      <path
        :fill="colorMap['Africa']"
        fill-opacity="0.25"
        :stroke="colorMap['Africa']"
        stroke-width="1.5"
        d="M480,220 L510,210 L540,220 L550,250 L560,290 L550,330 L530,360 L510,380 L490,370 L480,340 L470,300 L460,260 Z"
      />
      <text x="510" y="300" fill="var(--text)" font-size="13" font-weight="600" text-anchor="middle" opacity="0.9">Africa</text>

      <!-- Europe -->
      <path
        :fill="colorMap['Europe']"
        fill-opacity="0.25"
        :stroke="colorMap['Europe']"
        stroke-width="1.5"
        d="M460,80 L490,70 L530,75 L560,85 L570,110 L555,130 L540,140 L520,135 L500,145 L480,140 L460,130 L450,110 Z"
      />
      <text x="510" y="115" fill="var(--text)" font-size="13" font-weight="600" text-anchor="middle" opacity="0.9">Europe</text>

      <!-- North America -->
      <path
        :fill="colorMap['North America']"
        fill-opacity="0.25"
        :stroke="colorMap['North America']"
        stroke-width="1.5"
        d="M120,60 L180,50 L240,55 L280,70 L300,100 L290,130 L310,150 L300,180 L270,200 L240,220 L220,210 L200,230 L180,220 L160,200 L140,180 L120,150 L100,120 L110,90 Z"
      />
      <text x="210" y="145" fill="var(--text)" font-size="13" font-weight="600" text-anchor="middle" opacity="0.9">N. America</text>

      <!-- South America -->
      <path
        :fill="colorMap['South America']"
        fill-opacity="0.25"
        :stroke="colorMap['South America']"
        stroke-width="1.5"
        d="M240,250 L270,240 L300,250 L310,280 L320,320 L310,360 L290,390 L270,410 L250,400 L240,370 L230,330 L220,290 Z"
      />
      <text x="270" y="330" fill="var(--text)" font-size="13" font-weight="600" text-anchor="middle" opacity="0.9">S. America</text>

      <!-- Australia/Oceania -->
      <path
        :fill="colorMap['Australia/Oceania']"
        fill-opacity="0.25"
        :stroke="colorMap['Australia/Oceania']"
        stroke-width="1.5"
        d="M780,310 L820,300 L860,310 L880,330 L870,360 L850,380 L820,385 L790,375 L770,350 L770,330 Z"
      />
      <text x="825" y="350" fill="var(--text)" font-size="12" font-weight="600" text-anchor="middle" opacity="0.9">Oceania</text>

      <!-- Antarctica -->
      <path
        :fill="colorMap['Antarctica']"
        fill-opacity="0.2"
        :stroke="colorMap['Antarctica']"
        stroke-width="1.5"
        d="M200,460 L350,450 L500,455 L650,450 L800,460 L750,480 L600,485 L450,488 L300,485 L200,475 Z"
      />
      <text x="500" y="475" fill="var(--text)" font-size="12" font-weight="600" text-anchor="middle" opacity="0.7">Antarctica</text>

      <!-- Decorative dots for islands -->
      <circle cx="850" cy="280" r="3" :fill="colorMap['Australia/Oceania']" opacity="0.5" />
      <circle cx="870" cy="275" r="2" :fill="colorMap['Australia/Oceania']" opacity="0.4" />
      <circle cx="890" cy="290" r="2.5" :fill="colorMap['Australia/Oceania']" opacity="0.4" />
      <circle cx="910" cy="300" r="2" :fill="colorMap['Australia/Oceania']" opacity="0.3" />
      <circle cx="750" cy="285" r="2.5" :fill="colorMap['Asia']" opacity="0.4" />
      <circle cx="760" cy="275" r="2" :fill="colorMap['Asia']" opacity="0.4" />
    </svg>
  </div>
</template>

<style scoped>
.world-map {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 32px;
  overflow: hidden;
}

.world-map svg {
  width: 100%;
  height: auto;
  display: block;
}

.world-map path {
  transition: fill-opacity 0.2s ease;
  cursor: pointer;
}

.world-map path:hover {
  fill-opacity: 0.45;
}
</style>
