import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Img } from '../common/ui.jsx';
import { useLockBodyScroll } from '../../hooks/index.js';

/**
 * Main image + thumbnails. Swipe on mobile (CSS scroll-snap), hover-zoom on
 * desktop, tap/click opens a full-screen viewer with native pinch-zoom.
 */
export function ProductGallery({ images = [], name }) {
  const track = useRef(null);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(null);
  const [lightbox, setLightbox] = useState(false);
  useLockBodyScroll(lightbox);

  const go = useCallback((i) => {
    const el = track.current;
    if (!el) return;
    const next = Math.max(0, Math.min(images.length - 1, i));
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    setIndex(next);
  }, [images.length]);

  const onScroll = () => {
    const el = track.current;
    if (el) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

  const onMove = (e) => {
    if (window.matchMedia('(hover: none)').matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };

  if (!images.length) {
    return (
      <div className="gallery">
        <div className="gallery-main"><Img src="" label={name} alt={name} /></div>
      </div>
    );
  }

  return (
    <div className="gallery">
      <div className="gallery-main">
        <div className="gallery-track" ref={track} onScroll={onScroll}>
          {images.map((img, i) => (
            <div
              key={img.image_id || i}
              className={`gallery-slide ${zoom && i === index ? 'zooming' : ''}`}
              onMouseMove={onMove}
              onMouseLeave={() => setZoom(null)}
              onClick={() => setLightbox(true)}
              role="button"
              tabIndex={0}
              aria-label={`Open image ${i + 1} of ${images.length} full screen`}
              onKeyDown={(e) => e.key === 'Enter' && setLightbox(true)}
            >
              <Img
                src={img.url}
                alt={img.alt || name}
                label={name}
                loading={i === 0 ? 'eager' : 'lazy'}
                style={zoom && i === index ? { transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
              />
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <>
            <button type="button" className="gallery-nav prev" onClick={() => go(index - 1)} aria-label="Previous image"><ChevronLeft /></button>
            <button type="button" className="gallery-nav next" onClick={() => go(index + 1)} aria-label="Next image"><ChevronRight /></button>
            <div className="gallery-dots" aria-hidden="true">{images.map((_, i) => <span key={i} className={i === index ? 'on' : ''} />)}</div>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="gallery-thumbs">
          {images.map((img, i) => (
            <button key={img.image_id || i} type="button" aria-current={i === index} onClick={() => go(i)} aria-label={`Show image ${i + 1}`}>
              <Img src={img.url} alt="" label={name} />
            </button>
          ))}
        </div>
      )}
      {lightbox && createPortal(
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${name} images`}>
          <button type="button" className="lightbox-close" onClick={() => setLightbox(false)} aria-label="Close"><X /></button>
          <div className="lightbox-scroll">
            <img src={images[index]?.url} alt={images[index]?.alt || name} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
