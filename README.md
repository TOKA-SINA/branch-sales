# ქსელის ფინანსური ანალიზი

ქართულენოვანი ვებ-აპლიკაცია ფილიალების დღიური ნავაჭრის აღრიცხვისა და ანალიზისთვის.

## განთავსება

- `static/` ქვეყნდება GitHub Pages-ზე.
- `server.mjs` ამუშავებს API-ს Node.js ჰოსტინგზე.
- მონაცემთა ბაზის მისამართი და ავტორიზაციის საიდუმლო მნიშვნელობები ინახება მხოლოდ API ჰოსტინგის გარემოს ცვლადებში.

GitHub Pages-ის workflow ავტომატურად ქვეყნდება `main` branch-ზე push-ის შემდეგ. API-ს მისამართი ჩაიწერება `static/config.js`-ში:

```js
window.BRANCH_SALES_API_BASE = 'https://your-api-host.example.com';
```

API სერვერის გაშვება:

```powershell
npm ci
$env:DATABASE_URL = '<private pooled PostgreSQL URL>'
$env:FRONTEND_ORIGIN = 'https://toka-sina.github.io'
npm start
```

საიდუმლო გასაღებები, პაროლები და მონაცემთა ბაზის რეალური მისამართები რეპოზიტორიაში არ უნდა აიტვირთოს.

