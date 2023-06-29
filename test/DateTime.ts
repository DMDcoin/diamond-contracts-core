import { Contract } from "ethers";
import { ethers } from "hardhat";
import { expect } from "chai";
import _ from "lodash";

describe("DateTime utils library", function () {
    const secondsInDay = 24 * 60 * 60;

    let contract: Contract;

    let TestYears = _.range(2023, 2025);

    let TestYearsDifference = [
        { from: new Date(Date.UTC(2022, 0, 1)), to: new Date(Date.UTC(2022, 0, 2)), expected: 0 },
        { from: new Date(Date.UTC(2022, 0, 1)), to: new Date(Date.UTC(2023, 0, 1)), expected: 1 },
        { from: new Date(Date.UTC(2022, 0, 1)), to: new Date(Date.UTC(2032, 0, 1)), expected: 10 },
        { from: new Date(Date.UTC(2022, 0, 2)), to: new Date(Date.UTC(2031, 0, 1)), expected: 9 },
        { from: new Date(Date.UTC(2024, 1, 29)), to: new Date(Date.UTC(2025, 1, 28)), expected: 1 }
    ]

    function isLeapYear(year: number) {
        return ((year % 4 == 0) && (year % 100 != 0)) || (year % 400 == 0);
    }

    before(async function () {
        const contractFactory = await ethers.getContractFactory("DateTimeMock");

        contract = await contractFactory.deploy();
        expect(await contract.deployed());
    });

    it("should check leap year by timestamp", async function () {
        for (let year = 2023; year < 2101; ++year) {
            let isLeap = isLeapYear(year);
            let timestamp = Math.floor(new Date(Date.UTC(year, 2, 2)).getTime() / 1000);

            expect(await contract.isLeapYear(timestamp)).to.equal(isLeap);
        }
    });

    it('should correclty add years to timestamp', async function () {
        const baseDate = new Date(Date.UTC(2024, 1, 29));

        for (let years = 1; years <= 10; ++years) {
            let adjustedDate = new Date(baseDate);
            adjustedDate.setFullYear(baseDate.getFullYear() + years);

            let timestamp = Math.floor(baseDate.getTime() / 1000);
            let expectedTimestamp = Math.floor(adjustedDate.getTime() / 1000);

            // If resulting date exceeds maximum possible day in month, it will be adjusted
            if (!isLeapYear(adjustedDate.getFullYear())) {
                expectedTimestamp -= secondsInDay;
            }

            expect(await contract.addYears(timestamp, years)).to.equal(expectedTimestamp);
        }
    });

    TestYears.forEach((year) => {
        let yearString = `${isLeapYear(year) ? 'leap' : 'non-leap'} year ${year}`;

        it(`should correclty get number of days in month for ${yearString}`, async function () {
            for (let month = 1; month <= 12; ++month) {
                let date = new Date(Date.UTC(year, month, 0));

                let timestamp = Math.floor(date.getTime() / 1000);
                let daysInMoth = date.getDate();

                expect(await contract.getDaysInMonth(timestamp)).to.equal(daysInMoth);
            }
        });
    });

    TestYearsDifference.forEach((args, index) => {
        let fromTimestamp = Math.floor(args.from.getTime() / 1000);
        let toTimestamp = Math.floor(args.to.getTime() / 1000);

        it(`should correctly calculate date difference in years, test #${index + 1}`, async function () {
            expect(await contract.diffYears(fromTimestamp, toTimestamp)).to.equal(args.expected);
        });
    });
});
