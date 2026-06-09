// Shared Tailwind CDN configuration — included in all HTML pages.
// Must be loaded as a regular (non-module) script AFTER the Tailwind CDN script.
tailwind.config = {
    theme: {
        extend: {
            colors: {
                offWhite: "#f9f8f4",
                brandGreen: {
                    50:  "#f0f7f4",
                    100: "#dcfce7",
                    600: "#115e3b",
                    700: "#0b462e",
                    800: "#062d1e",
                },
                brandCyan: {
                    50:  "#ecfeff",
                    100: "#cffafe",
                    200: "#a5f3fc",
                    500: "#06b6d4",
                    600: "#0891b2",
                    700: "#0e7490",
                },
            },
        },
    },
};
