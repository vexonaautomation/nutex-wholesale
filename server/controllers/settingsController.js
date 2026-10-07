import {
  getCatalog, listPublicCategories, listPublicColors, listPublicSizes, publicSlabs, mediaUrl,
} from '../services/catalogService.js';
import { publicSettings, getSettings, updateSettings } from '../services/settingsService.js';
import { DEFAULT_SETTINGS } from '../config/defaults.js';
import { ctx } from './helpers.js';

function decorate(settings) {
  return {
    ...settings,
    company_logo_url: mediaUrl(settings.company_logo_file_id),
    size_chart_url: mediaUrl(settings.size_chart_file_id),
    payment_qr_url: mediaUrl(settings.payment_qr_file_id),
    // sample QR (text only, not payable) shown until a real QR is uploaded
    payment_qr_demo_url: '/media/demo-payment-qr.png',
  };
}

// One request bootstraps the storefront: settings + categories + colors + sizes + slabs
export async function store(_req, res) {
  const catalog = await getCatalog();
  res.set('Cache-Control', 'public, max-age=20');
  res.json({
    settings: decorate(publicSettings(catalog.settings)),
    categories: listPublicCategories(catalog),
    colors: listPublicColors(catalog),
    sizes: listPublicSizes(catalog),
    slabs: publicSlabs(catalog),
    server_time: new Date().toISOString(),
  });
}

export async function publicGet(_req, res) {
  const catalog = await getCatalog();
  res.json({ settings: decorate(publicSettings(catalog.settings)) });
}

export async function adminGet(_req, res) {
  const settings = await getSettings({ fresh: true });
  res.json({
    settings: decorate(settings),
    definitions: DEFAULT_SETTINGS.map(({ key, type, options, description, public: isPublic }) => ({ key, type, options, description, public: isPublic })),
  });
}

export async function adminUpdate(req, res) {
  const result = await updateSettings(req.body, ctx(req));
  res.json({ ...result, settings: decorate(result.settings) });
}
