import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		opacity: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, `${i / 100}`])),
  		/* One radius per role: 8px controls, 12px cards/panels, 4px small elements.
  		   Legacy names (2xl, lg) resolve to the same role values so existing
  		   surfaces cannot drift apart. */
  		borderRadius: {
  			sm: 'var(--radius-sm)',
  			DEFAULT: 'var(--radius)',
  			md: 'var(--radius)',
  			lg: 'var(--radius)',
  			xl: 'var(--radius-card)',
  			'2xl': 'var(--radius-card)',
  			full: '9999px'
  		},
  		boxShadow: {
  			card: 'var(--shadow-card)',
  			panel: 'var(--shadow-panel)'
  		},
  		/* Spacing is a 4px grid. The default scale's 2px half-steps are folded onto
  		   the nearest grid step (0.5→4px, 1.5→8px, 2.5→12px, 3.5→16px) so padding,
  		   gaps and margins can never land off-grid. All other steps keep their
  		   4px-multiple defaults (1 = 4px, 2 = 8px, 3 = 12px, 4 = 16px, …). */
  		spacing: {
  			'0.5': '4px',
  			'1.5': '8px',
  			'2.5': '12px',
  			'3.5': '16px'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				muted: 'hsl(var(--success-muted))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				muted: 'hsl(var(--warning-muted))'
  			},
  			info: {
  				DEFAULT: 'hsl(var(--info))',
  				muted: 'hsl(var(--info-muted))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		fontFamily: {
  			heading: ['var(--font-heading)'],
  			body: ['var(--font-body)'],
  			display: ['var(--font-display)'],
  			mono: ['var(--font-mono)']
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [animate],
}
