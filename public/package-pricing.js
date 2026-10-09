export const packages = {
  'Triple Occupancy': { base: 14999, gstPercent: 18, total: 17699 },
  'Double Occupancy': { base: 17499, gstPercent: 18, total: 21239 },
  'Family + Double Occupancy': { base: 32999, gstPercent: 18, total: 38939 },
  'Family + Triple Occupancy': { base: 39999, gstPercent: 18, total: 47199 },
};

export const formatRupees = (amount) => Number(amount).toLocaleString('en-IN', {
  maximumFractionDigits: 0,
});