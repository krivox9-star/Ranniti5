export const packages = {
  'Triple Occupancy': { base: 14999, gstPercent: 18 },
  'Double Occupancy': { base: 17499, gstPercent: 18 },
  'Family + Double Occupancy': { base: 32999, gstPercent: 18 },
  'Family + Triple Occupancy': { base: 39999, gstPercent: 18 },
};

export const calculatePackagePrice = ({ base, gstPercent }) => {
  const basePaise = Math.round(Number(base) * 100);
  const gstPaise = Math.round(basePaise * Number(gstPercent) / 100);
  const totalPaise = basePaise + gstPaise;
  return {
    base: basePaise / 100,
    gstPercent: Number(gstPercent),
    gstAmount: gstPaise / 100,
    total: totalPaise / 100,
    basePaise,
    gstPaise,
    totalPaise,
  };
};

export const formatRupees = (amount, fractionDigits = 2) => Number(amount).toLocaleString('en-IN', {
  minimumFractionDigits: fractionDigits,
  maximumFractionDigits: fractionDigits,
});