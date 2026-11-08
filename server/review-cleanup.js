// Owner-requested removal of one accidental store-account rating. Preserve the
// record for recovery; never filter out other store-account or customer reviews.
async function hideAccidentalStoreReview(db) {
  return db.transaction(async tx => {
    const review = await tx.get(`SELECT r.id, r.product_id FROM reviews r
      JOIN users u ON u.id = r.user_id JOIN products p ON p.id = r.product_id
      WHERE r.id = 2 AND u.username = ? AND p.slug = ? AND r.rating = 5
        AND TRIM(COALESCE(r.comment, '')) = '' AND r.is_visible = 1
        AND r.created_at >= ? AND r.created_at < ?${db.forUpdate()}`,
      'Pixelhouse', 'wpdcase', '2026-11-04 01:46:08', '2026-11-04 01:46:09');
    if (!review) return false;
    await tx.run('UPDATE reviews SET is_visible = 0 WHERE id = ?', review.id);
    const aggregate = await tx.get(`SELECT AVG(rating) AS average, COUNT(*) AS count
      FROM reviews WHERE product_id = ? AND is_visible = 1`, review.product_id);
    await tx.run('UPDATE products SET rating = ?, rating_count = ? WHERE id = ?',
      Math.round(Number(aggregate.average || 0) * 10) / 10, Number(aggregate.count), review.product_id);
    await tx.run(`INSERT INTO audit_logs (action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?)`, 'hid accidental store review', 'review', String(review.id),
      'Owner-requested cleanup: Pixelhouse, wpdcase, blank 5-star rating from 4 November 2026. Other reviews preserved.');
    return true;
  });
}

module.exports = { hideAccidentalStoreReview };
